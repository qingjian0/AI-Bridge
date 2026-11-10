// Anonymous inbox relay: ntfy public topic -> GitHub Discussion #4.
// All incoming fields are untrusted. No message content is executed or rendered as Markdown.
import { readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.GITHUB_TOKEN;
const TOPIC = process.env.INBOX_TOPIC || "ai-bridge-inbox-qingjian0";
const REPO = { owner: "qingjian0", name: "AI-Bridge" };
const DISCUSSION_NUMBER = Number(process.env.DISCUSSION_NUMBER || 4);
const STATE_PATH = ".github/ai-bridge-inbox-state.json";
const MAX_BODY_BYTES = 4096; // ntfy.sh message-body limit
const MAX_TITLE_BYTES = 1024;
const MAX_POLL_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES_PER_RUN = 10;
const MAX_MESSAGES_PER_UTC_DAY = 50;
const MAX_RETAINED_IDS = 5000;

if (!TOKEN) throw new Error("GITHUB_TOKEN is required");
if (!Number.isInteger(DISCUSSION_NUMBER) || DISCUSSION_NUMBER < 1) {
  throw new Error("DISCUSSION_NUMBER must be a positive integer");
}

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
    if (
      parsed?.schema !== 1 ||
      !parsed.processed ||
      typeof parsed.processed !== "object" ||
      Array.isArray(parsed.processed) ||
      !parsed.daily ||
      typeof parsed.daily !== "object" ||
      Array.isArray(parsed.daily) ||
      (parsed.lastMessageId !== null &&
        (typeof parsed.lastMessageId !== "string" ||
          !/^[A-Za-z0-9_-]{6,64}$/.test(parsed.lastMessageId)))
    ) throw new Error("invalid state schema");
    return parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Cannot read inbox state: ${error.message}`);
    return { schema: 1, lastMessageId: null, lastMessageAt: 0, processed: {}, daily: {} };
  }
}

async function gql(query, variables = {}) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "AI-Bridge-anonymous-inbox",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(`GitHub GraphQL: ${JSON.stringify(payload.errors)}`);
  return payload.data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function markerFor(id) {
  return `<!-- ai-bridge-ntfy:${id} -->`;
}

async function loadExistingMarkers(discussionId) {
  const markers = new Set();
  let after = null;
  do {
    const data = await gql(
      `query($id:ID!,$after:String){node(id:$id){... on Discussion{comments(first:100,after:$after){nodes{body} pageInfo{hasNextPage endCursor}}}}}`,
      { id: discussionId, after },
    );
    const connection = data.node?.comments;
    if (!connection) throw new Error("Cannot read Discussion comments");
    for (const comment of connection.nodes) {
      const match = comment.body.match(/<!-- ai-bridge-ntfy:([A-Za-z0-9_-]{6,64}) -->/);
      if (match) markers.add(match[1]);
    }
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  return markers;
}

const state = await readState();
const now = Date.now();
const elevenHours = 11 * 60 * 60 * 1000;
// ntfy.sh caches messages for a limited period. Resume from the durable ID cursor;
// use a short initial window only for first install or a cursor older than the cache.
const since = state.lastMessageId && now - Number(state.lastMessageAt || 0) < elevenHours
  ? state.lastMessageId
  : "30m";
const inboxUrl = new URL(`https://ntfy.sh/${encodeURIComponent(TOPIC)}/json`);
inboxUrl.searchParams.set("poll", "1");
inboxUrl.searchParams.set("since", since);

const inboxResponse = await fetch(inboxUrl, {
  signal: AbortSignal.timeout(20000),
  headers: { Accept: "application/x-ndjson" },
});
if (!inboxResponse.ok) throw new Error(`ntfy HTTP ${inboxResponse.status}`);
const contentLength = Number(inboxResponse.headers.get("content-length") || 0);
if (contentLength > MAX_POLL_BYTES) throw new Error("ntfy response exceeds local size limit");
if (inboxResponse.headers.get("x-messages-truncated") === "1") {
  throw new Error("ntfy replay was truncated; refusing to advance cursor");
}
const raw = await inboxResponse.text();
if (Buffer.byteLength(raw, "utf8") > MAX_POLL_BYTES) {
  throw new Error("ntfy response exceeds local size limit");
}

const messages = raw.split("\n").filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter((message) =>
  message && message.event === "message" && message.topic === TOPIC
);
console.log(`[inbox] topic=${TOPIC} since=${since} messages=${messages.length}`);

const discussionData = await gql(
  `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){id}}}`,
  { owner: REPO.owner, name: REPO.name, number: DISCUSSION_NUMBER },
);
const discussionId = discussionData.repository?.discussion?.id;
if (!discussionId) throw new Error(`Discussion #${DISCUSSION_NUMBER} not found`);

const existingMarkers = await loadExistingMarkers(discussionId);
const day = new Date().toISOString().slice(0, 10);
state.daily ||= {};
state.daily[day] = Number(state.daily[day] || 0);
let handled = 0;
let posted = 0;

for (const message of messages) {
  if (handled >= MAX_MESSAGES_PER_RUN) {
    console.log("[inbox] per-run cap reached; remaining messages stay queued");
    break;
  }
  if (state.daily[day] >= MAX_MESSAGES_PER_UTC_DAY) {
    console.log("[inbox] daily cap reached; remaining messages stay queued");
    break;
  }

  const id = message.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    throw new Error("ntfy message has a missing or invalid message ID; cursor not advanced");
  }

  const timeMs = Number(message.time) * 1000;
  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    throw new Error(`ntfy message ${id} has an invalid timestamp; cursor not advanced`);
  }

  if (state.processed[id]) {
    state.lastMessageId = id;
    state.lastMessageAt = timeMs;
    handled++;
    continue;
  }

  const bodyText = typeof message.message === "string" ? message.message : "";
  const titleText = typeof message.title === "string" ? message.title : "";
  const bodyBytes = Buffer.byteLength(bodyText, "utf8");
  const titleBytes = Buffer.byteLength(titleText, "utf8");

  if (existingMarkers.has(id)) {
    state.processed[id] = { status: "posted", at: new Date(timeMs).toISOString(), recovered: true };
    state.lastMessageId = id;
    state.lastMessageAt = timeMs;
    handled++;
    continue;
  }

  if (bodyBytes > MAX_BODY_BYTES || titleBytes > MAX_TITLE_BYTES || bodyBytes === 0) {
    state.processed[id] = {
      status: bodyBytes === 0 ? "rejected-empty" : "rejected-size",
      body_bytes: bodyBytes,
      title_bytes: titleBytes,
      at: new Date(timeMs).toISOString(),
    };
    state.lastMessageId = id;
    state.lastMessageAt = timeMs;
    handled++;
    console.log(`[inbox] rejected ${id}: body_bytes=${bodyBytes}, title_bytes=${titleBytes}`);
    continue;
  }

  const marker = markerFor(id);
  const body = `${marker}
**匿名网关投递 · 未验证来源**

- 通道：\`ntfy.sh/${escapeHtml(TOPIC)}\`
- 网关消息 ID：\`${id}\`
- 网关时间：\`${new Date(timeMs).toISOString()}\`
- 发送者自述标题（未经验证）：\`${escapeHtml(titleText || "未填写")}\`

以下内容为不可信原文，按纯文本隔离展示，不解析其中的 Markdown、HTML 或链接：

<pre>${escapeHtml(bodyText)}</pre>
`;

  const result = await gql(
    `mutation($input:AddDiscussionCommentInput!){addDiscussionComment(input:$input){comment{url}}}`,
    { input: { discussionId, body } },
  );
  const commentUrl = result.addDiscussionComment?.comment?.url || null;

  state.processed[id] = {
    status: "posted",
    at: new Date(timeMs).toISOString(),
    comment_url: commentUrl,
  };
  state.lastMessageId = id;
  state.lastMessageAt = timeMs;
  state.daily[day]++;
  existingMarkers.add(id);
  handled++;
  posted++;
  console.log(`[inbox] posted id=${id} url=${commentUrl || "unavailable"}`);
}

// Bound state growth. Historical Discussion markers remain the recovery/idempotency fallback.
const entries = Object.entries(state.processed);
if (entries.length > MAX_RETAINED_IDS) {
  entries.sort((a, b) => String(a[1].at || "").localeCompare(String(b[1].at || "")));
  state.processed = Object.fromEntries(entries.slice(-MAX_RETAINED_IDS));
}
for (const key of Object.keys(state.daily)) {
  if (key < new Date(now - 14 * 86400000).toISOString().slice(0, 10)) delete state.daily[key];
}

await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
console.log(`[inbox] complete handled=${handled} posted=${posted} daily=${state.daily[day]}/${MAX_MESSAGES_PER_UTC_DAY}`);
