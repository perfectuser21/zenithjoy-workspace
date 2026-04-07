import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

// 抖音 OAuth 回调 - 用 code 换 access_token
router.get('/auth/douyin/callback', async (req: Request, res: Response) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>❌ 缺少 code 参数</h2></body></html>');
  }

  try {
    const response = await axios.post(
      'https://open.douyin.com/oauth/access_token/',
      null,
      {
        params: {
          client_key: process.env.DOUYIN_CLIENT_KEY,
          client_secret: process.env.DOUYIN_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
        },
      }
    );

    const data = response.data?.data;

    if (data?.access_token) {
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2>✅ 抖音授权成功</h2>
          <p>open_id: ${data.open_id}</p>
          <p>scope: ${data.scope}</p>
          <p>access_token 已获取，可关闭此页面</p>
        </body></html>
      `);
    } else {
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2>❌ 授权失败</h2>
          <pre>${JSON.stringify(response.data, null, 2)}</pre>
        </body></html>
      `);
    }
  } catch (err: any) {
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>❌ 请求失败</h2>
        <pre>${err.message}</pre>
      </body></html>
    `);
  }
});

export default router;
