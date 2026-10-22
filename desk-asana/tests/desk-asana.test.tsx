import type { On } from 'claude-code'
import { describe, expect, test, type TestBody } from 'claude-code/testing'

import { commentCall, doneSince, dueChip, findAsanaServer, groupTasks, listCalls, mentionHtml, nextOffset, notesMarkdown, paneTools, projectTasksCall, storyPatch, storyView, textDiff, toDetail, toProjects, toStory, toTasks, updateCall, updateProblem } from '../hooks/asana'
import { setLang } from '../hooks/i18n'
import { parseBlocks, parseInline, plainText } from '../hooks/shared/markdown'

const KO = { options: { language: 'ko' } }
const VIEWPORT = { columns: 100, rows: 40 }
// 테스트 환경의 실제 시간 대기(타입 정의에 setTimeout 이 없어 globalThis 로).
const wait = (ms: number) =>
  new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout(resolve, ms))


describe('Asana 패널', () => {
  const V2 = ['get_my_tasks', 'search_tasks', 'get_task', 'get_task_stories', 'add_comment', 'update_tasks', 'search_objects', 'get_me', 'get_projects', 'get_tasks'].map(tool => `mcp__asana-v2__${tool}`)
  const V1 = [
    'asana_search_tasks',
    'asana_get_task',
    'asana_get_stories_for_task',
    'asana_create_task_story',
    'asana_update_task',
    'asana_typeahead_search',
    'asana_get_user',
    'asana_get_projects',
    'asana_get_tasks',
  ].map(
    tool => `mcp__claude_ai_asana__${tool}`,
  )

  test('서버는 v2(get_my_tasks)를 먼저, 없으면 claude.ai 커넥터를 쓰고, 패널이 쓰는 도구가 다 있어야 한다', () => {
    expect(findAsanaServer(['Read', ...V1, ...V2])).toEqual({ name: 'asana-v2', dialect: 'v2' })
    expect(findAsanaServer(V1)).toEqual({ name: 'claude_ai_asana', dialect: 'v1' })
    expect(findAsanaServer(V2.filter(name => !name.endsWith('add_comment')))).toBeNull()
    expect(findAsanaServer(['mcp__other__get_my_tasks'])).toBeNull()
    expect(paneTools({ name: 'asana-v2', dialect: 'v2' })).toEqual(V2)
    // v1 은 목록과 검색이 같은 도구라 한 번만
    expect(paneTools({ name: 'claude_ai_asana', dialect: 'v1' })).toEqual(V1)
  })

  test('상세는 v2 댓글과 v1 활동에서 댓글만 고르고, 드롭다운 필드만 바꿀 수 있게 둔다', () => {
    const task = {
      data: {
        gid: '1',
        name: 'API 25',
        notes: '본문',
        completed: false,
        assignee: { gid: 'u1', name: 'Sam' },
        memberships: [{ project: { name: 'Support' }, section: { name: '이슈' } }],
        custom_type_status_option: { name: 'Open' },
        custom_type: { status_options: [{ gid: 's1', name: 'Open' }, { gid: 's2', name: 'Done' }, { gid: 's3', name: '옛 상태', enabled: false }] },
        custom_fields: [
          { gid: 'f1', name: 'Issue Type', type: 'enum', display_value: '질문', enum_options: [{ gid: 'o1', name: '질문' }, { gid: 'o2', name: '옛것', enabled: false }] },
          { gid: 'f2', name: '고객사', type: 'text', display_value: 'ACME' },
        ],
        comments: [{ gid: 'c1', text: '확인바랍니다', created_at: '2026-10-14T07:33:47Z', created_by: { name: 'Alex' }, resource_subtype: 'comment_added' }],
      },
    }
    const v2 = toDetail(task)
    expect(v2?.status).toBe('Open')
    expect(v2?.statuses).toEqual([{ gid: 's1', name: 'Open' }, { gid: 's2', name: 'Done' }])
    expect(v2?.places).toEqual(['Support › 이슈'])
    expect(v2?.comments.map(c => c.author)).toEqual(['Alex'])
    expect(v2?.fields[0]?.options).toEqual([{ gid: 'o1', name: '질문' }])
    expect(v2?.fields[1]?.options).toBeNull()
    const stories = {
      data: [
        { gid: 's1', text: 'X added this task', resource_subtype: 'added_to_project', created_by: { name: 'X' } },
        { gid: 's2', text: '첫 댓글', resource_subtype: 'comment_added', created_by: { name: 'Y' }, created_at: '2026-10-15T00:00:00Z' },
      ],
    }
    expect(toDetail(task, stories)?.comments.map(c => c.text)).toEqual(['첫 댓글'])
    // v2 stories 는 최근 것부터, html_text 를 서식으로. stories 가 목록이 아니면 get_task 의 평문 댓글
    const latest = {
      data: [
        { gid: 'c3', text: 'https://app.asana.com/0/9/ 둘째', html_text: '<body><a href="https://app.asana.com/0/9/" data-asana-type="user">@Albert</a> 둘째<ul><li><strong>본문</strong>: <code>a=b</code></li></ul></body>', resource_subtype: 'comment_added', created_at: '2026-10-16T00:00:00Z' },
        { gid: 'c2', text: '첫째', html_text: '<body>첫째</body>', resource_subtype: 'comment_added', created_at: '2026-10-15T00:00:00Z' },
      ],
    }
    expect(toDetail(task, latest)?.comments.map(c => [c.gid, c.richText])).toEqual([
      ['c2', '첫째'],
      ['c3', '[@Albert](https://app.asana.com/0/9/) 둘째\n\n- **본문**: `a=b`'],
    ])
    expect(toDetail(task, { data: { gid: 'x' } })?.comments.map(c => [c.text, c.richText])).toEqual([['확인바랍니다', null]])
  })

  test('Asana 본문 html_notes 를 마크다운으로 옮겨 서식을 살린다', () => {
    const html =
      '<body><h2>목적</h2>CH 저장량을 줄이려고 <strong>프로파일 샘플링</strong>을 씁니다.\n두 번째 문단 *별* a_b\n' +
      '<ul><li>버퍼(<code>profile_buffer_size</code>)마다 <a href="https://app.asana.com/0/0/1/f/" data-asana-gid="1" data-asana-type="task">[의견] 정리</a> 참고' +
      '<ul><li>안쪽</li></ul></li></ul><ol><li>에러 → 저장</li><li>나머지</li></ol>' +
      '<pre>map&lt;int64, int64&gt; a = 2;  // 기존</pre>- 줄 머리 대시\n1. 번호 같은 글<hr/><blockquote>인용</blockquote></body>'
    const md = notesMarkdown(html)
    expect(md).toBe(
      [
        '## 목적',
        'CH 저장량을 줄이려고 **프로파일 샘플링**을 씁니다.',
        '두 번째 문단 \\*별\\* a\\_b',
        '- 버퍼(`profile_buffer_size`)마다 [\\[의견\\] 정리](https://app.asana.com/0/0/1/f/) 참고\n  - 안쪽',
        '1. 에러 → 저장\n2. 나머지',
        '```\nmap<int64, int64> a = 2;  // 기존\n```',
        '\\- 줄 머리 대시',
        '1\\. 번호 같은 글',
        '***',
        '> 인용',
      ].join('\n\n'),
    )
    const blocks = parseBlocks(md)
    expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'paragraph', 'list', 'list', 'code', 'paragraph', 'paragraph', 'rule', 'quote'])
    const text = (index: number) => {
      const block = blocks[index]
      return block?.kind === 'paragraph' ? plainText(parseInline(block.text)) : null
    }
    expect(text(2)).toBe('두 번째 문단 *별* a_b')
    expect(text(6)).toBe('- 줄 머리 대시')
    expect(text(7)).toBe('1. 번호 같은 글')
    const list = blocks[3]
    const link = list?.kind === 'list' ? parseInline(list.items[0]?.text ?? '').find(node => node.kind === 'link') : undefined
    expect(link?.kind === 'link' ? [link.href, plainText(link.children)] : null).toEqual(['https://app.asana.com/0/0/1/f/', '[의견] 정리'])
    expect(toDetail({ data: { gid: '1', html_notes: '<body>a</body>' } })?.richNotes).toBe('a')
    expect(toDetail({ data: { gid: '1', notes: 'a' } })?.richNotes).toBeNull()
  })

  test('바꾸기 호출 모양과, v2 가 키를 버려 0건이면 실패로 본다', () => {
    const v2 = { name: 'asana-v2', dialect: 'v2' } as const
    const v1 = { name: 'claude_ai_asana', dialect: 'v1' } as const
    expect(updateCall(v2, '1', { field: 'f1', option: 'o1' })).toEqual({ tool: 'update_tasks', args: { tasks: [{ task: '1', custom_fields: { f1: 'o1' } }] } })
    expect(updateCall(v1, '1', { field: 'f1', option: 'o1' })).toEqual({ tool: 'asana_update_task', args: { task_id: '1', custom_fields: '{"f1":"o1"}' } })
    expect(updateCall(v1, '1', { assignee: 'me' }).args).toEqual({ task_id: '1', assignee: 'me' })
    expect(updateProblem(v2, { data: [], failed: [], summary: 'Updated 0 of 1 tasks.' })).toBe('Updated 0 of 1 tasks.')
    expect(updateProblem(v2, { data: [{ gid: '1' }], failed: [] })).toBeNull()
    expect(updateProblem(v2, { data: [], failed: [{ errors: ['Not a user'] }] })).toContain('Not a user')
  })

  test('마감일 칩과 프로젝트 묶음', () => {
    expect(dueChip('2026-10-15', '2026-10-16')).toEqual({ text: '10/15', level: 'danger' })
    expect(dueChip('2026-10-16', '2026-10-16')?.level).toBe('warning')
    expect(dueChip('2027-01-02', '2026-10-16')).toEqual({ text: '2027/1/2', level: 'muted' })
    expect(dueChip(null, '2026-10-16')).toBeNull()
    const task = (gid: string, project: string | null) => ({ gid, name: gid, dueOn: null, project, section: null, url: null, assignee: null, isDone: false, status: null })
    expect(groupTasks([task('a', null), task('b', 'P'), task('c', 'Q'), task('d', 'P')]).map(g => [g.name, g.tasks.map(t => t.gid)])).toEqual([
      ['P', ['b', 'd']],
      ['Q', ['c']],
      [null, ['a']],
    ])
  })

  test('목록 → 상세 → 댓글 달기·Claude 에게 맡기기·담당자 두 번 눌러 넘기기', KO, async ($, on) => {
    const calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = []
    const filled: string[] = []
    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-16T03:00:00Z') }))
    on('clock.after', () => new Promise(() => undefined) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined as never }))
    on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
    on('prompt.fill', ($, e) => {
      filled.push((e as { text: string }).text)
      return { isFilled: true } as never
    })
    on('tool.list', () => ({ value: [...V1, ...V2].map(name => ({ name, description: '', mcp: true })) }))
    // 댓글 달기만 allow 규칙이 없다
    on('tool.check', ($, e) => ({ decision: e.tool === 'mcp__asana-v2__add_comment' ? 'ask' : 'allow' }) as never)
    on('mcp.call', ($, e) => {
      calls.push({ server: e.server, tool: e.tool, args: e.args })
      switch (e.tool) {
        case 'get_my_tasks':
          return text({
            data: [
              { gid: '1', name: 'API 25 문의', due_on: '2026-10-10', memberships: [{ project: { name: 'Support' } }] },
              { gid: '2', name: '혼자 하는 일', due_on: null, memberships: [] },
            ],
          })
        case 'get_task':
          return text({
            data: {
              gid: '1',
              name: 'API 25 문의',
              notes: '운영 제약 확인',
              assignee: { gid: 'u1', name: 'Sam' },
              custom_type_status_option: { name: 'Open' },
              permalink_url: 'https://app.asana.com/x/1',
              comments: [{ gid: 'c1', text: '확인바랍니다', created_by: { name: 'Alex' }, resource_subtype: 'comment_added' }],
            },
          })
        case 'get_task_stories':
          return text({ data: [{ gid: 'c1', text: '확인바랍니다', html_text: '<body>확인<strong>바랍니다</strong></body>', created_by: { name: 'Alex' }, resource_subtype: 'comment_added' }] })
        case 'search_objects':
          return text({ data: [{ gid: 'u9', name: 'Alex', email: 'alex@example.com' }] })
        case 'update_tasks':
          return text({ data: [{ gid: '1' }], failed: [] })
        default:
          return text({ data: { gid: 'new' } })
      }
    })

    await $.command.run({ command: 'desk-asana', args: '' } as never)
    expect(calls[0]).toMatchObject({ server: 'asana-v2', tool: 'get_my_tasks' })
    const pane = await $.ui.mount({ plugin: 'desk-asana', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    let drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('내 태스크 2')
    expect(drawn).toContain('Support')
    expect(drawn).toContain('프로젝트 없음')
    expect(drawn).toContain('10/10')
    expect(drawn).toContain('허용 규칙이 없어')
    expect(drawn).toContain('\\"mcp__asana-v2__add_comment\\",')
    expect(drawn).not.toContain('mcp__asana-v2__get_task')

    await pane.press({ key: 'asana-task-1' })
    await wait(50)
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('● Open')
    expect(drawn).toContain('운영 제약 확인')
    // 댓글은 stories 의 html_text 를 서식으로
    expect(calls.find(call => call.tool === 'get_task_stories')?.args).toMatchObject({ task_id: '1', resource_subtype: 'comment_added', sort_ascending: false })
    expect(drawn).toContain('["확인",{"type":"Text","props":{"weight":"semibold"},"children":["바랍니다"]}]')

    await pane.press({ key: 'asana-claude' })
    expect(filled[0]).toContain('Asana 태스크 "API 25 문의"')
    expect(filled[0]).toContain('- Alex: 확인바랍니다')

    await pane.input({ key: 'asana-write-1-0', text: '확인했습니다\n내일 답변' })
    await wait(50)
    expect(calls.find(call => call.tool === 'add_comment')?.args).toEqual({ task_id: '1', text: '확인했습니다\n내일 답변' })

    // 지우기: 쓴 글을 비운 칸을 새 키로 그린다
    await pane.input({ key: 'asana-write-1-1', text: '붙여 넣은\n긴 글', kind: 'change' })
    await pane.press({ key: 'asana-write-clear' })
    expect(JSON.stringify(await pane.find({ key: 'asana-write-1-2' }))).toContain('"value":""')

    // 멘션: 찾은 사람을 누르면 댓글 칸에 "@이름 " 이 끼워지고, 보내면 html_text 의 <a data-asana-gid/> 가 된다
    await pane.press({ key: 'asana-mention' })
    await pane.input({ key: 'asana-mention-search', text: 'nom' })
    await wait(50)
    await pane.press({ key: 'asana-mention-u9' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('asana-write-1-3')
    expect(drawn).toContain('@Alex ')
    expect(drawn).not.toContain('asana-mention-search')
    await pane.input({ key: 'asana-write-1-3', text: '@Alex 확인 <부탁>\n내일' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'add_comment').at(-1)?.args).toEqual({ task_id: '1', html_text: '<body><a data-asana-gid="u9"/> 확인 &lt;부탁&gt;\n내일</body>' })

    // 담당자: 찾고, 한 번 누르면 확인 문구, 다시 눌러야 넘긴다
    await pane.press({ key: 'asana-assign' })
    await pane.input({ key: 'asana-user-search', text: 'nom' })
    await wait(50)
    await pane.press({ key: 'asana-user-u9' })
    expect(calls.some(call => call.tool === 'update_tasks')).toBe(false)
    expect(JSON.stringify(await pane.drawn())).toContain('Alex 에게 넘길까요?')
    await pane.press({ key: 'asana-user-u9' })
    await wait(50)
    expect(calls.find(call => call.tool === 'update_tasks')?.args).toEqual({ tasks: [{ task: '1', assignee: 'u9' }] })

    await pane.press({ key: 'asana-back' })
    expect(JSON.stringify(await pane.drawn())).toContain('내 태스크')
    await pane.unmount()
  })

  test('멘션 html: 긴 이름부터, 지운 멘션은 그냥 글, 특수 문자는 이스케이프', () => {
    const kim = { gid: '1', name: 'Kim', email: null }
    const kimLee = { gid: '2', name: 'Kim Lee', email: null }
    expect(mentionHtml('@Kim Lee 와 @Kim 확인', [kim, kimLee])).toBe('<body><a data-asana-gid="2"/> 와 <a data-asana-gid="1"/> 확인</body>')
    expect(mentionHtml('그냥 글 & 끝', [kim])).toBeNull()
    expect(mentionHtml('@A.B 와 @AxB', [{ gid: '3', name: 'A.B', email: null }])).toBe('<body><a data-asana-gid="3"/> 와 @AxB</body>')
    expect(mentionHtml('@R&D 팀', [{ gid: '4', name: 'R&D', email: null }])).toBe('<body><a data-asana-gid="4"/> 팀</body>')
    const v1 = { name: 'claude_ai_asana', dialect: 'v1' as const }
    expect(commentCall(v1, '9', '@Kim 봐 주세요', [kim])).toEqual({ tool: 'asana_create_task_story', args: { task_id: '9', html_text: '<body><a data-asana-gid="1"/> 봐 주세요</body>' } })
    expect(commentCall(v1, '9', '봐 주세요', [kim]).args).toEqual({ task_id: '9', text: '봐 주세요' })
  })

  test('글자 diff: 바뀐 덩어리만, 옛 글 자리로', () => {
    expect(textDiff('abc', 'abc')).toEqual([])
    expect(textDiff('굵게 둔 글', '굵게 고친 글')).toEqual([{ start: 3, end: 4, text: '고친' }])
    expect(textDiff('하나 둘 셋', '하나 둘째 셋 넷')).toEqual([
      { start: 4, end: 4, text: '째' },
      { start: 6, end: 6, text: ' 넷' },
    ])
    expect(textDiff('지울 글', '글')).toEqual([{ start: 0, end: 3, text: '' }])
    expect(textDiff('', '새 글')).toEqual([{ start: 0, end: 0, text: '새 글' }])
    // 거의 새로 쓴 긴 글은 가운데를 통째로 바꾸는 한 덩어리로(기억이 D² 로 불지 않게)
    const old = `머리 ${'가나다라'.repeat(800)} 꼬리`
    const rewritten = `머리 ${'마바사아'.repeat(800)} 꼬리`
    const started = Date.now()
    expect(textDiff(old, rewritten)).toEqual([{ start: 3, end: old.length - 3, text: '마바사아'.repeat(800) }])
    expect(Date.now() - started).toBeLessThan(2000)
    expect(storyPatch(`<body>${old}</body>`, rewritten)).toEqual({ html: `<body>${rewritten}</body>` })
  })

  test('댓글 고치기 원문: 서식은 그대로 두고 바뀐 글자만 html_text 에 끼운다', () => {
    // 실제 Asana 모양(2026-10-19): text 는 멘션을 프로필 URL 로 풀고 서식을 버려 html_text 에서 만든다. 줄바꿈은 \n 그대로
    const html =
      '<body><a href="https://app.asana.com/1/1/profile/2" data-asana-gid="9" data-asana-accessible="true" data-asana-type="user" data-asana-dynamic="true">@Arnold</a> 결론은 <strong>굵게 둔 글</strong> 입니다 &amp; 끝.\n<ul><li>하나</li><li>둘</li></ul>마지막</body>'
    expect(storyView(html)?.text).toBe('@Arnold 결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n• 둘\n마지막')
    // 굵은 글 안·목록 안·끝을 고치면 그 자리만 바뀌고 태그·멘션은 바이트 그대로
    expect(storyPatch(html, '@Arnold 결론은 굵게 고친 글 입니다 & 끝.\n• 하나\n• 둘째\n마지막 (고침)')).toEqual({
      html: '<body><a href="https://app.asana.com/1/1/profile/2" data-asana-gid="9" data-asana-accessible="true" data-asana-type="user" data-asana-dynamic="true">@Arnold</a> 결론은 <strong>굵게 고친 글</strong> 입니다 &amp; 끝.\n<ul><li>하나</li><li>둘째</li></ul>마지막 (고침)</body>',
    })
    // 멘션은 통째로 지울 수 있다
    expect(storyPatch(html, '결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n• 둘\n마지막')).toEqual({
      html: '<body>결론은 <strong>굵게 둔 글</strong> 입니다 &amp; 끝.\n<ul><li>하나</li><li>둘</li></ul>마지막</body>',
    })
    // 멘션 글자 일부, 목록 기호는 못 바꾼다
    expect(storyPatch(html, '@Arnol 결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n• 둘\n마지막')).toEqual({ error: 'format' })
    expect(storyPatch(html, '@Arnold 결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n둘\n마지막')).toEqual({ error: 'format' })
    expect(storyPatch(html, storyView(html)?.text ?? '')).toBeNull()
    // 멘션 바로 뒤에 붙인 글은 멘션 밖, 앞 글 조각에
    expect(storyPatch(html, '@Arnold님 결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n• 둘\n마지막')).toMatchObject({ html: expect.stringContaining('</a>님 결론은') })
  })

  test('댓글 고치기 원문: 이미지·번호 목록·코드 블록·인용도 자리를 지킨다', () => {
    setLang('ko')
    const image = '<body><img src="https://x/a.png" data-asana-gid="1" data-asana-type="attachment" />분석 X-View</body>'
    expect(storyView(image)?.text).toBe('[이미지]분석 X-View')
    expect(storyPatch(image, '[이미지]분석된 X-View')).toEqual({ html: '<body><img src="https://x/a.png" data-asana-gid="1" data-asana-type="attachment" />분석된 X-View</body>' })
    expect(storyPatch(image, '분석 X-View')).toEqual({ error: 'format' })

    const blocks = '<body>머리\n<ol><li>첫째</li><li>둘째</li></ol><pre>a &lt; b\nc</pre><blockquote>인용 <a href="https://e.x/">https://e.x/</a></blockquote>꼬리</body>'
    expect(storyView(blocks)?.text).toBe('머리\n1. 첫째\n2. 둘째\na < b\nc\n인용 https://e.x/\n꼬리')
    expect(storyPatch(blocks, '머리말\n1. 첫째\n2. 둘째\na <= b\nc\n인용문 https://e.x/\n꼬리')).toEqual({
      html: '<body>머리말\n<ol><li>첫째</li><li>둘째</li></ol><pre>a &lt;= b\nc</pre><blockquote>인용문 <a href="https://e.x/">https://e.x/</a></blockquote>꼬리</body>',
    })
    expect(storyPatch('<body></body>', '새 글')).toEqual({ html: '<body>새 글</body>' })

    // 고친 조각 안의 안 바꾼 글자는 원래 모양(&quot;)을 지킨다
    expect(storyPatch('<body>&quot;기획&quot; 확인</body>', '"기획" 다시 확인')).toEqual({ html: '<body>&quot;기획&quot; 다시 확인</body>' })
    // 줄 첫머리 목록 기호 바로 앞에 쓴 글은 앞 문단 끝으로 갈 수밖에 없어 거절하고, 줄로 끝나면(새 줄 넣기) 받는다
    const list = '<body>머리\n<ul><li>하나</li></ul></body>'
    expect(storyPatch(list, '머리\n앞• 하나')).toEqual({ error: 'format' })
    expect(storyPatch(list, '머리\n새 줄\n• 하나')).toEqual({ html: '<body>머리\n새 줄\n<ul><li>하나</li></ul></body>' })
  })

  const editMock = (
    on: On,
    fetched: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }>,
    { tokenOwner = 'u1', toasts = [] as string[], storyHtml = (): string => '<body><a data-asana-gid="u9" data-asana-type="user">@Alex</a> 확인</body>', putStatus = (): number => 200, tools = [] as string[] } = {},
  ) => {
    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-16T03:00:00Z') }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', ($, e) => {
      toasts.push(JSON.stringify(e))
      return { value: undefined as never }
    })
    on('tool.list', () => ({ value: V2.map(name => ({ name, description: '', mcp: true })) }))
    on('mcp.call', ($, e) => {
      tools.push(e.tool)
      if (e.tool === 'get_my_tasks') return text({ data: [{ gid: '1', name: 'API 25 문의', memberships: [] }] })
      if (e.tool === 'get_me') return text({ data: { gid: 'u1', name: 'Sam' } })
      return text({
        data: {
          gid: '1',
          name: 'API 25 문의',
          custom_type_status_option: { name: '검토 중' },
          custom_type: { status_options: [{ gid: 'st1', name: '검토 중' }, { gid: 'st2', name: '진행 중' }] },
          comments: [
            { gid: 'c1', text: '@Alex 확인', created_by: { gid: 'u1', name: 'Sam' }, resource_subtype: 'comment_added' },
            { gid: 'c2', text: '남의 댓글', created_by: { gid: 'u9', name: 'Alex' }, resource_subtype: 'comment_added' },
          ],
        },
      })
    })
    on('http.fetch', ($, e) => {
      fetched.push({ url: e.url, init: e.init })
      const body = e.url.includes('/users/me')
        ? { data: { gid: tokenOwner } }
        : e.init?.method === 'PUT'
          ? { data: { gid: 'c1', text: '고친 글' } }
          : { data: { gid: 'c1', html_text: storyHtml(), created_by: { gid: 'u1' } } }
      if (e.init?.method === 'PUT' && putStatus() !== 200) return { value: { status: putStatus(), ok: false, headers: {}, text: JSON.stringify({ errors: [{ message: 'Forbidden' }] }) } } as never
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } } as never
    })
  }
  const openTask = async ($: Parameters<TestBody>[0]) => {
    await $.command.run({ command: 'desk-asana', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-asana', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    await pane.press({ key: 'asana-task-1' })
    await wait(50)
    return pane
  }

  test('댓글 고치기: 토큰이 있으면 내 댓글만 ✎, REST 로 원문을 읽어 멘션을 지키며 고친다', { options: { language: 'ko', asanaToken: ' pat-1 ' } }, async ($, on) => {
    const fetched: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = []
    const tools: string[] = []
    editMock(on, fetched, { tools })
    const pane = await openTask($)
    // get_task_stories 에 allow 규칙이 없으면 부르지 않고 get_task 의 평문 댓글을 쓴다
    expect(tools).not.toContain('get_task_stories')
    expect(await pane.find({ key: 'asana-edit-c1' })).toBeDefined()
    expect(await pane.find({ key: 'asana-edit-c2' })).toBeUndefined()

    await pane.press({ key: 'asana-edit-c1' })
    await wait(50)
    expect(fetched.map(call => call.url).sort()).toEqual([
      'https://app.asana.com/api/1.0/stories/c1?opt_fields=html_text,created_by.gid',
      'https://app.asana.com/api/1.0/users/me?opt_fields=gid',
    ])
    expect(fetched[0]?.init?.headers?.Authorization).toBe('Bearer pat-1')
    expect(JSON.stringify(await pane.drawn())).toContain('asana-editing-c1')

    // 지우기: 원문을 비운 칸을 새 키로 그린다
    await pane.press({ key: 'asana-edit-clear-c1' })
    expect(JSON.stringify(await pane.find({ key: 'asana-editing-c1-1' }))).toContain('"value":""')

    await pane.input({ key: 'asana-editing-c1-1', text: '@Alex 다시 확인' })
    await wait(50)
    const put = fetched.find(call => call.init?.method === 'PUT')
    expect(put?.url).toBe('https://app.asana.com/api/1.0/stories/c1?opt_fields=text')
    expect(JSON.parse(put?.init?.body ?? '{}')).toEqual({ data: { html_text: '<body><a data-asana-gid="u9" data-asana-type="user">@Alex</a> 다시 확인</body>' } })
    expect(JSON.stringify(await pane.drawn())).not.toContain('asana-editing-c1')
    await pane.unmount()
  })

  test('댓글 고치기: 토큰 주인이 쓴 댓글이 아니면 열지 않는다', { options: { language: 'ko', asanaToken: 'pat-2' } }, async ($, on) => {
    const fetched: Array<{ url: string; init?: { method?: string } }> = []
    const toasts: string[] = []
    editMock(on, fetched, { tokenOwner: 'someone-else', toasts })
    const pane = await openTask($)
    await pane.press({ key: 'asana-edit-c1' })
    await wait(50)
    expect(toasts.join()).toContain('내가 쓴 댓글만')
    expect(JSON.stringify(await pane.drawn())).not.toContain('asana-editing-c1')
    expect(fetched.some(call => call.init?.method === 'PUT')).toBe(false)
    await pane.unmount()
  })

  test('댓글 고치기: 서식이 있어도 열고 바뀐 글자만 보내며, 서식 자리를 건드리거나 저장이 실패하면 고치던 글을 둔다', { options: { language: 'ko', asanaToken: 'pat-3' } }, async ($, on) => {
    const fetched: Array<{ url: string; init?: { method?: string; body?: string } }> = []
    const toasts: string[] = []
    let status = 403
    editMock(on, fetched, { toasts, storyHtml: () => '<body>목록\n<ul><li><strong>하나</strong></li></ul></body>', putStatus: () => status })
    const pane = await openTask($)
    await pane.press({ key: 'asana-edit-c1' })
    await wait(50)
    expect(JSON.stringify(await pane.drawn())).toContain('목록\\n• 하나')

    // 목록 기호를 지우면 보내지 않는다
    await pane.input({ key: 'asana-editing-c1-0', text: '목록\n하나' })
    await wait(50)
    expect(toasts.join()).toContain('목록 기호')
    expect(fetched.some(call => call.init?.method === 'PUT')).toBe(false)
    // 칸은 Enter 뒤에 비므로 고치던 글을 새 키로 다시 그린다
    expect(JSON.stringify(await pane.find({ key: 'asana-editing-c1-1' }))).toContain('목록\\n하나')

    // 저장이 거절되면 고치던 글을 둔다
    await pane.input({ key: 'asana-editing-c1-1', text: '목록\n• 하나둘' })
    await wait(50)
    expect(toasts.join()).toContain('Forbidden')
    expect(JSON.stringify(await pane.find({ key: 'asana-editing-c1-2' }))).toContain('하나둘')

    status = 200
    await pane.input({ key: 'asana-editing-c1-2', text: '목록\n• 하나둘' })
    await wait(50)
    expect(JSON.parse(fetched.filter(call => call.init?.method === 'PUT').at(-1)?.init?.body ?? '{}')).toEqual({
      data: { html_text: '<body>목록\n<ul><li><strong>하나둘</strong></li></ul></body>' },
    })
    expect(JSON.stringify(await pane.drawn())).not.toContain('asana-editing-c1')
    await pane.unmount()
  })

  test('댓글 고치기: 토큰이 없으면 REST 를 부르지 않고 넣는 법을 알린다', KO, async ($, on) => {
    const fetched: Array<{ url: string }> = []
    editMock(on, fetched)
    const pane = await openTask($)
    await pane.press({ key: 'asana-edit-c1' })
    await wait(50)
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('개인 토큰(PAT)이 있어야')
    expect(drawn).toContain('/plugin configure desk-asana@cc-desktop-mod')
    expect(fetched).toEqual([])
    await pane.press({ key: 'asana-edit-c1' })
    expect(JSON.stringify(await pane.drawn())).not.toContain('개인 토큰(PAT)이 있어야')
    await pane.unmount()
  })

  test('상태 바꾸기: 토큰이 있으면 고른 상태를 REST 로 바꾸고 상세를 다시 읽는다', { options: { language: 'ko', asanaToken: 'pat-4' } }, async ($, on) => {
    const fetched: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = []
    editMock(on, fetched)
    const pane = await openTask($)
    expect(await pane.find({ key: 'asana-status-st2' })).toBeUndefined()
    await pane.press({ key: 'asana-status' })
    expect(JSON.stringify(await pane.find({ key: 'asana-status-st1' }))).toContain('✓ 검토 중')
    await pane.press({ key: 'asana-status-st2' })
    await wait(50)
    expect(fetched.map(call => call.url)).toEqual(['https://app.asana.com/api/1.0/tasks/1?opt_fields=gid'])
    expect(fetched[0]?.init?.method).toBe('PUT')
    expect(fetched[0]?.init?.headers?.Authorization).toBe('Bearer pat-4')
    expect(JSON.parse(fetched[0]?.init?.body ?? '{}')).toEqual({ data: { custom_type_status_option: 'st2' } })
    expect(await pane.find({ key: 'asana-status-st2' })).toBeUndefined()
    await pane.unmount()
  })

  test('상태 바꾸기: 토큰이 없으면 REST 를 부르지 않고 넣는 법을 알린다', KO, async ($, on) => {
    const fetched: Array<{ url: string }> = []
    editMock(on, fetched)
    const pane = await openTask($)
    await pane.press({ key: 'asana-status' })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('상태 바꾸기는 Asana 개인 토큰(PAT)이 있어야')
    expect(drawn).not.toContain('asana-status-st2')
    expect(fetched).toEqual([])
    await pane.unmount()
  })

  test('내 태스크: 최근 14일 안에 완료된 것도 읽어 끝에 상태와 함께 묶는다(v1 은 완료 쪽을 따로 부른다)', KO, async ($, on) => {
    const since = doneSince(Date.parse('2026-10-17T03:00:00Z'))
    expect(since).toBe('2026-10-03T03:00:00.000Z')
    expect(listCalls({ name: 'a', dialect: 'v2' }, since).map(call => call.args.completed_since)).toEqual([since])
    expect(listCalls({ name: 'a', dialect: 'v1' }, since).map(call => [call.args.completed, call.args.completed_at_after])).toEqual([
      [false, undefined],
      [true, since],
    ])

    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-17T03:00:00Z') }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.list', () => ({ value: V2.map(name => ({ name, description: '', mcp: true })) }))
    on('mcp.call', () =>
      text({
        data: [
          { gid: '1', name: '진행하는 일', memberships: [] },
          { gid: '2', name: '멈춘 일', completed: true, custom_type_status_option: { name: '보류' }, memberships: [] },
          { gid: '3', name: '끝낸 일', completed: true, memberships: [] },
        ],
      }),
    )
    await $.command.run({ command: 'desk-asana', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-asana', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    await wait(50)
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('내 태스크 1')
    expect(drawn).toContain('최근 14일 완료 · 2')
    expect(drawn).toContain('● 보류')
    expect(drawn.indexOf('진행하는 일')).toBeLessThan(drawn.indexOf('최근 14일 완료'))
    expect(JSON.stringify(await pane.find({ key: 'asana-task-2' }))).toContain('"dimColor":true')
    await pane.unmount()
  })

  test('검색창: 워크스페이스 태스크를 담당자와 함께, 상세에서 돌아오면 검색 결과, ✕ 나 빈 검색이면 내 태스크', KO, async ($, on) => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-16T03:00:00Z') }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.list', () => ({ value: V2.map(name => ({ name, description: '', mcp: true })) }))
    on('mcp.call', ($, e) => {
      calls.push({ tool: e.tool, args: e.args })
      if (e.tool === 'get_my_tasks') return text({ data: [{ gid: '1', name: '내 일', memberships: [] }] })
      if (e.tool === 'search_tasks') {
        return text({ data: [{ gid: '7', name: 'API 25 문의', assignee: { gid: 'u9', name: 'Alex' }, memberships: [{ project: { name: 'Product Support' } }] }] })
      }
      return text({ data: { gid: '7', name: 'API 25 문의', assignee: { gid: 'u9', name: 'Alex' } } })
    })

    await $.command.run({ command: 'desk-asana', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-asana', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    await pane.input({ key: 'asana-search-0', text: ' API ' })
    await wait(50)
    expect(calls.find(call => call.tool === 'search_tasks')?.args).toMatchObject({ text: 'API', completed: false })
    expect(String(calls.find(call => call.tool === 'search_tasks')?.args.opt_fields)).toContain('assignee.name')
    let drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('검색 \\"API\\" 1')
    expect(drawn).toContain('Product Support')
    expect(drawn).toContain(' Alex')
    expect(drawn).not.toContain('내 일')

    await pane.press({ key: 'asana-task-7' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'get_task').at(-1)).toMatchObject({ tool: 'get_task', args: { task_id: '7' } })
    await pane.press({ key: 'asana-back' })
    expect(JSON.stringify(await pane.drawn())).toContain('API 25 문의')

    // ↻ 는 검색을 다시 한다
    await pane.press({ key: 'asana-refresh' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'search_tasks').length).toBe(2)

    await pane.press({ key: 'asana-search-clear' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('내 태스크 1')
    expect(drawn).toContain('내 일')

    await pane.input({ key: 'asana-search-1', text: 'API' })
    await wait(50)
    await pane.input({ key: 'asana-search-1', text: '  ' })
    await wait(50)
    expect(JSON.stringify(await pane.drawn())).toContain('내 태스크 1')
    await pane.unmount()
  })

  test('프로젝트 응답: 내가 멤버인지, 최근에 바뀐 것부터, 태스크는 고른 프로젝트의 섹션으로', () => {
    const projects = toProjects(
      {
        data: [
          { gid: 'p1', name: '옛 일', members: [{ gid: 'me' }], modified_at: '2026-01-01T00:00:00Z' },
          { gid: 'p2', name: 'Platform', members: [{ gid: 'u2' }, { gid: 'me' }], modified_at: '2026-10-16T00:00:00Z', task_counts: { num_incomplete_tasks: 77 } },
          { gid: 'p3', name: '남의 일', members: [{ gid: 'u2' }], modified_at: '2026-10-17T00:00:00Z' },
        ],
      },
      'me',
    )
    expect(projects.map(p => [p.gid, p.isMine, p.members, p.open])).toEqual([
      ['p3', false, 1, null],
      ['p2', true, 2, 77],
      ['p1', true, 1, null],
    ])
    // 두 프로젝트에 걸친 태스크는 고른 프로젝트의 섹션을 쓴다
    const tasks = toTasks(
      { data: [{ gid: 't1', name: 'x', memberships: [{ project: { gid: 'p9', name: 'Other' }, section: { name: '딴 섹션' } }, { project: { gid: 'p2', name: 'Platform' }, section: { name: '백엔드' } }] }] },
      'p2',
    )
    expect(tasks[0]).toMatchObject({ project: 'Platform', section: '백엔드' })
    expect(nextOffset({ data: [], next_page: { offset: 'abc' } })).toBe('abc')
    expect(nextOffset({ data: [], next_page: null })).toBeNull()
    const v2 = { name: 'asana-v2', dialect: 'v2' } as const
    expect(projectTasksCall(v2, 'p2', '2026-10-17T03:00:00.000Z', 'abc')).toMatchObject({ tool: 'get_tasks', args: { project: 'p2', completed_since: '2026-10-17T03:00:00.000Z', offset: 'abc' } })
    expect(projectTasksCall(v2, 'p2', '2026-10-17T03:00:00.000Z').args).not.toHaveProperty('offset')
  })

  test('프로젝트 탭: 내 프로젝트 → 섹션별 모든 사람의 열린 태스크 → 상세 → 돌아오면 그 프로젝트', KO, async ($, on) => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-17T03:00:00Z') }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.list', () => ({ value: V2.map(name => ({ name, description: '', mcp: true })) }))
    on('mcp.call', ($, e) => {
      calls.push({ tool: e.tool, args: e.args })
      const apm = (gid: string, name: string, section: string, assignee: string) => ({
        gid,
        name,
        assignee: { gid: assignee, name: assignee },
        memberships: [{ project: { gid: 'p2', name: 'Platform' }, section: { name: section } }],
      })
      switch (e.tool) {
        case 'get_my_tasks':
          return text({ data: [] })
        case 'get_me':
          return text({ data: { gid: 'me', name: 'Sam' } })
        case 'get_projects':
          return e.args.offset === undefined
            ? text({ data: [{ gid: 'p2', name: 'Platform', members: [{ gid: 'me' }], modified_at: '2026-10-16T00:00:00Z', task_counts: { num_incomplete_tasks: 3 } }], next_page: { offset: 'pg2' } })
            : text({ data: [{ gid: 'p3', name: '남의 프로젝트', members: [{ gid: 'u2' }], modified_at: '2026-10-17T00:00:00Z' }], next_page: null })
        case 'get_tasks':
          return e.args.offset === undefined
            ? text({ data: [apm('t1', '정리', 'Untitled section', 'Aiden'), apm('t2', '통계 api', '백엔드', 'Sam')], next_page: { offset: 'tp2' } })
            : text({ data: [apm('t3', '세션 관리', '백엔드', 'Jordan'), { ...apm('t4', '멈춘 일', '백엔드', 'Sam'), completed: true, custom_type_status_option: { name: '보류' } }], next_page: null })
        default:
          return text({ data: { gid: 't3', name: '세션 관리', assignee: { gid: 'Jordan', name: 'Jordan' } } })
      }
    })

    await $.command.run({ command: 'desk-asana', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-asana', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    await pane.press({ key: 'asana-tab-projects' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'get_projects').map(call => call.args.offset)).toEqual([undefined, 'pg2'])
    let drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('● 프로젝트')
    expect(drawn).toContain('내 프로젝트 1')
    expect(drawn).toContain('멤버 1 · 열린 3')
    expect(drawn).not.toContain('남의 프로젝트')

    await pane.press({ key: 'asana-project-p2' })
    await wait(50)
    const tasksCalls = calls.filter(call => call.tool === 'get_tasks')
    // 열린 태스크와 최근 14일 안에 완료된 태스크(보류처럼 완료로 치는 상태)를 함께 읽는다
    expect(tasksCalls[0]?.args).toMatchObject({ project: 'p2', completed_since: '2026-10-03T03:00:00.000Z' })
    expect(tasksCalls[0]?.args).not.toHaveProperty('assignee')
    expect(tasksCalls[1]?.args.offset).toBe('tp2')
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('열린 태스크 3')
    expect(drawn).toContain('섹션 없음')
    expect(drawn).toContain('백엔드')
    expect(drawn).toContain(' Jordan')
    expect(drawn.indexOf('섹션 없음')).toBeLessThan(drawn.indexOf('백엔드'))
    // 완료된 태스크는 섹션이 아니라 끝의 최근 완료 묶음에 상태와 함께
    expect(drawn).toContain('최근 14일 완료 · 1')
    expect(drawn).toContain('● 보류')
    expect(drawn.indexOf('세션 관리')).toBeLessThan(drawn.indexOf('멈춘 일'))

    // 섹션을 접으면 그 태스크가 빠진다
    await pane.press({ key: 'asana-section-1' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).not.toContain('세션 관리')
    await pane.press({ key: 'asana-section-1' })

    // 모두 접기(z): 하나라도 펴져 있으면 다 접고, 다 접혔으면 다 편다. 다시 읽기는 r
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'asana-fold-all' }))).toContain('"hotkey":"z"')
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'asana-project-refresh' }))).toContain('"hotkey":"r"')
    await pane.press({ key: 'asana-section-0' })
    await pane.press({ key: 'asana-fold-all' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).not.toContain('정리')
    expect(drawn).not.toContain('세션 관리')
    expect(drawn).toContain('모두 펴기')
    await pane.press({ key: 'asana-fold-all' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('정리')
    expect(drawn).toContain('세션 관리')
    expect(drawn).toContain('모두 접기')

    await pane.press({ key: 'asana-task-t3' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'get_task').at(-1)).toMatchObject({ tool: 'get_task', args: { task_id: 't3' } })
    await pane.press({ key: 'asana-back-end' })
    expect(JSON.stringify(await pane.drawn())).toContain('세션 관리')

    await pane.press({ key: 'asana-project-back-end' })
    expect(JSON.stringify(await pane.drawn())).toContain('내 프로젝트 1')
    await pane.press({ key: 'asana-tab-mine' })
    expect(JSON.stringify(await pane.drawn())).toContain('내 태스크 0')
    await pane.unmount()
  })

  test('Asana 서버가 없으면 연결하라고 알린다', KO, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.list', () => ({ value: [{ name: 'Read', description: '', mcp: false }] }))
    const result = JSON.stringify(await $.command.run({ command: 'desk-asana', args: '' } as never))
    expect(result).toContain('Asana MCP 서버가 연결돼 있지 않아요')
  })
})
