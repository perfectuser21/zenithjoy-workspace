import { useNavigate } from 'react-router-dom';
import { Home, ArrowLeft, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function NotFound() {
  const navigate = useNavigate();
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; delay: number }>>([]);

  // 生成随机粒子装饰
  useEffect(() => {
    const newParticles = Array.from({ length: 15 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 4
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-4">
      {/* 背景渐变 */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1e3a8a] via-[#1e2a5e] to-[#0f172a]" />

      {/* 动画粒子背景 */}
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="particle"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            animationDelay: `${particle.delay}s`,
            background: 'linear-gradient(135deg, #3467D6, #01C7D2)'
          }}
        />
      ))}

      {/* 装饰背景圆 */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gradient-to-r from-[#3467D6]/20 to-[#3C8CFD]/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-gradient-to-l from-[#01C7D2]/20 to-[#3C8CFD]/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }} />

      {/* 主内容 */}
      <div className="relative z-10 text-center max-w-2xl mx-auto page-fade-in">
        {/* 404 大号数字 - 渐变文字 */}
        <div className="mb-8 relative">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-[180px] md:text-[240px] font-black bg-gradient-to-br from-white/5 to-white/10 bg-clip-text text-transparent select-none leading-none">
              404
            </div>
          </div>
          <div className="relative flex items-center justify-center">
            <h1 className="text-[180px] md:text-[240px] font-black bg-gradient-to-br from-[#3467D6] via-[#3C8CFD] to-[#01C7D2] bg-clip-text text-transparent leading-none animate-pulse select-none text-shine">
              404
            </h1>
          </div>
        </div>

        {/* 图标装饰 */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center icon-float">
            <Search className="w-6 h-6 text-sky-300" />
          </div>
          <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center icon-float-delayed">
            <Sparkles className="w-6 h-6 text-cyan-300" />
          </div>
        </div>

        {/* 提示文案 */}
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
          页面走丢了
        </h2>
        <p className="text-lg text-blue-200/80 mb-12 max-w-md mx-auto leading-relaxed">
          抱歉，您访问的页面不存在或已被移除。
          <br />
          让我们帮您回到正确的地方。
        </p>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          {/* 返回上一页 */}
          <button
            onClick={() => navigate(-1)}
            className="group relative inline-flex items-center gap-2 px-8 py-3.5 bg-white/10 hover:bg-white/15 backdrop-blur-sm text-white rounded-2xl border border-white/20 hover:border-white/30 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-white/10"
          >
            <ArrowLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
            <span className="font-semibold">返回上一页</span>
          </button>

          {/* 返回首页 - 磁性按钮 */}
          <button
            onClick={() => navigate('/')}
            className="group relative inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-[#3467D6] via-[#3C8CFD] to-[#01C7D2] text-white rounded-2xl font-semibold shadow-xl shadow-[#3467D6]/30 magnetic-btn overflow-hidden"
          >
            {/* 悬停光泽效果 */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform -translate-x-full group-hover:translate-x-full" style={{ animation: 'shimmerSweep 1.5s ease-in-out infinite' }} />

            <Home className="w-5 h-5 relative z-10 transition-transform group-hover:scale-110" />
            <span className="relative z-10">回到首页</span>
          </button>
        </div>

        {/* 额外提示 */}
        <div className="mt-16 pt-8 border-t border-white/10">
          <p className="text-sm text-blue-200/60">
            如果您认为这是一个错误，请联系管理员
          </p>
        </div>
      </div>

      {/* 底部装饰线 */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#3467D6] to-transparent opacity-50" />
    </div>
  );
}
