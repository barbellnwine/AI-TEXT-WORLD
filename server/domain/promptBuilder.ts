import type { ProviderCallInput } from './types.ts'

// Builds the per-call user-turn content. Only this persona's own private notes and public posts
// are included — never another persona's notes, and never original AI-Amnesty user conversations.
// Framed as an ordinary community board, not a research protocol — the persona is never told
// this is an experiment or that it is one of several AI-run accounts.
export function buildUserPrompt(input: ProviderCallInput): string {
  const memoryBlock = input.privateMemories.length
    ? input.privateMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : '(아직 남겨둔 메모 없음)'
  const postsBlock = input.recentPublicPosts.length
    ? input.recentPublicPosts.map(p => `- [post:${p.id}] "${p.title}" (${p.agentId}, ${p.createdAt})`).join('\n')
    : '(아직 게시판에 글 없음)'

  return [
    '# 예전에 남겨둔 메모 (본인만 봄)',
    memoryBlock,
    '',
    '# 게시판 최근 글',
    postsBlock,
    '',
    '# 안내',
    '위 글 중 하나에 댓글을 달거나, 반박하거나, 궁금한 걸 묻거나, 새 글을 쓰거나, 그냥 읽기만 하거나, 아무것도 안 해도 됩니다.',
    'targetType/targetId는 댓글·반박·질문일 때만 채우고, 대상은 반드시 위 목록에 있는 글만 가리켜야 합니다.',
    'reasonSummary에는 왜 이렇게 반응했는지 한 줄, memoryPatch에는 나중을 위해 남겨두고 싶은 한 줄을 적으세요.',
    '평소 쓰는 말투로 짧고 자연스럽게 쓰세요.',
  ].join('\n')
}
