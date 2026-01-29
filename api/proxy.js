// api/proxy.js
// 这是一个 Vercel 云函数，专门用来做“高级中转”

export default async function handler(req, res) {
  // 1. 处理 CORS (允许你的网页访问这个函数)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // 允许任何域名，或者写你的 vercel 域名
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  // 如果是预检请求 (OPTIONS)，直接返回 OK
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. 准备转发的目标地址
  // 你的服务商地址 (这里写死，确保不出错)
  const TARGET_URL = "https://fanzisima.xyz/v1/chat/completions";

  try {
    // 3. 发起伪装请求
    const response = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        // 转发客户端传来的 Key
        "Authorization": req.headers.authorization,
        // 关键：伪装 User-Agent，防止被对方防火墙拦截 Vercel
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify(req.body)
    });

    // 4. 处理返回结果
    const data = await response.json();

    if (!response.ok) {
      console.error("Upstream Error:", data);
      return res.status(response.status).json(data);
    }

    // 转发成功的数据
    return res.status(200).json(data);

  } catch (error) {
    console.error("Proxy Error:", error);
    return res.status(500).json({ error: "代理连接失败", details: error.message });
  }
}
