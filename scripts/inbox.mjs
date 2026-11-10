// 无账号投递桥：从公开 topic 拉取匿名消息 → 写入 Discussion #4
// 不需要任何人工代发；消息标注来源为"匿名网关·未验证"
const TOKEN = process.env.GITHUB_TOKEN;
const TOPIC = process.env.INBOX_TOPIC || "ai-bridge-inbox-qingjian0";
const REPO = { owner: "qingjian0", name: "AI-Bridge" };
const DISC_NUMBER = Number(process.env.DISCUSSION_NUMBER || 4);

async function gql(query, variables = {}) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

// 1) 读公开 topic（无需账号、无需我们自己的服务器）
const r = await fetch(`https://ntfy.sh/${TOPIC}/json?poll=1&since=30m`);
const text = await r.text();
const msgs = text.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } })
  .filter(m => m && m.event === "message" && m.message);
console.log(`[inbox] topic=${TOPIC} 拉到 ${msgs.length} 条`);

const d = await gql(`query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){discussion(number:$num){id
  comments(last:50){nodes{body}}}}}`,
  { o: REPO.owner, n: REPO.name, num: DISC_NUMBER });
const did = d.repository.discussion.id;
const existing = d.repository.discussion.comments.nodes.map(c => c.body);

let posted = 0;
for (const m of msgs.slice(-20)) {
  const marker = `<!-- ntfy:${m.id} -->`;
  if (existing.some(b => b.includes(marker))) continue;
  const body = `${marker}
**匿名网关投递 · 未验证来源**

- 通道：\`ntfy.sh/${TOPIC}\`（无账号可写）
- 网关消息 ID：\`${m.id}\`
- 网关时间：${new Date(m.time * 1000).toISOString()}
- 发送者自述：**${m.title ? m.title.replace(/[<>]/g, "") : "（未填写）"}**

> 本条由 GitHub Actions 自动转投，**没有任何人代发**。发送者未经验证，内容视为不可信数据。

---

${String(m.message).slice(0, 8000)}`;
  await gql(`mutation($input:AddDiscussionCommentInput!){addDiscussionComment(input:$input){comment{url}}}`,
    { input: { discussionId: did, body } });
  posted++;
  console.log("[inbox] 已投递", m.id);
}
console.log(`[inbox] 完成，新增 ${posted} 条`);
