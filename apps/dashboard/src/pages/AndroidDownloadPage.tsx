/**
 * AndroidDownloadPage — Line02 Path2 Step3 安卓客户端自助装机绑定（下载页）
 *
 * 客户在此页下载安卓 APK，并扫描深链二维码自动绑定，替代命令行/人工发包。
 */
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { getAndroidInstallPack } from '../api/walking-skeleton-1.api';

export default function AndroidDownloadPage() {
  const q = useQuery({
    queryKey: ['android-install-pack'],
    queryFn: getAndroidInstallPack,
    retry: false,
  });
  const data = q.data;
  const copy = () => {
    if (data?.license_key) navigator.clipboard?.writeText(data.license_key);
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>下载安卓客户端</h1>
      {q.isError && (
        <p>
          请先登录后再下载（<a href="/signup">去登录/注册</a>）。
        </p>
      )}
      {data && (
        <>
          {/* 激活码卡 */}
          <section style={{ background: '#fffbe6', padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <div>
              你的激活码：<b>{data.license_key || '（尚未激活套餐）'}</b>
              {data.license_key && (
                <button onClick={copy} style={{ marginLeft: 8 }}>
                  复制
                </button>
              )}
            </div>
            <div style={{ color: '#888', fontSize: 12 }}>版本 {data.version}</div>
          </section>
          {/* 下载 + 二维码卡 */}
          <section style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 16 }}>
            <div>
              <a
                href={data.apk_url}
                download
                style={{
                  display: 'inline-block',
                  padding: '12px 20px',
                  background: '#2563eb',
                  color: '#fff',
                  borderRadius: 8,
                  textDecoration: 'none',
                }}
              >
                下载安卓客户端 (APK)
              </a>
              <p style={{ color: '#888', fontSize: 12 }}>用手机浏览器打开本页下载，或扫右侧二维码绑定。</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <QRCodeSVG value={data.deeplink} size={180} />
              <div style={{ fontSize: 12, color: '#888' }}>装好 app 后，手机扫此码自动绑定</div>
            </div>
          </section>
          {/* 授权引导 */}
          <section style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
            <h3>安装与授权步骤</h3>
            <ol>
              <li>手机浏览器下载 APK → 点开安装（首次会提示「允许安装未知来源」，点允许）。</li>
              <li>打开 App → 点「开启无障碍权限」→ 在系统设置里打开「抖音采集/养号」服务 → 返回 App。</li>
              <li>用手机系统相机/微信「扫一扫」扫上方二维码 → 自动绑定到你的账号。</li>
              <li>在手机上登录抖音小号 → 回本站点关键词，手机自动采集。</li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
