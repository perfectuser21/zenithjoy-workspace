import { useState, useEffect, useMemo, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Users,
  BarChart3,
  Clock,
  CheckCircle,
  Video,
  Sparkles,
  Activity,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  Quote,
  Timer,
  PartyPopper,
  Send,
  ClipboardList,
  Bot
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi, type DashboardStats } from '../api';

// 每日一言库
const DAILY_QUOTES = [
  { text: '把每一件简单的事做好就是不简单。', author: '稻盛和夫' },
  { text: '不要等待机会，而要创造机会。', author: '林肯' },
  { text: '成功不是终点，失败也不是终结，唯有勇气才是永恒。', author: '丘吉尔' },
  { text: '今天的努力是明天的礼物。', author: '佚名' },
  { text: '专注于当下，未来自然清晰。', author: '佚名' },
  { text: '简单的事情重复做，你就是专家。', author: '佚名' },
  { text: '与其担心未来，不如现在好好努力。', author: '佚名' },
  { text: '每一个优秀的人，都有一段沉默的时光。', author: '佚名' },
  { text: '你所浪费的今天，是昨天死去的人奢望的明天。', author: '佚名' },
  { text: '行动是治愈恐惧的良药，而犹豫只会滋养恐惧。', author: '佚名' },
  { text: '摸鱼一时爽，一直摸鱼一直爽。', author: '打工人' },
  { text: '今天又是充满希望的一天！', author: '乐观主义者' },
];

// 节日配置
const HOLIDAYS: Record<string, { name: string; greeting: string; emoji: string }> = {
  '01-01': { name: '元旦', greeting: '新年快乐！新的一年，新的开始', emoji: '🎊' },
  '02-14': { name: '情人节', greeting: '愿你被爱包围', emoji: '💕' },
  '03-08': { name: '妇女节', greeting: '女神节快乐！', emoji: '👑' },
  '04-01': { name: '愚人节', greeting: '今天说的话要小心哦', emoji: '🤡' },
  '05-01': { name: '劳动节', greeting: '劳动最光荣！不过今天可以休息', emoji: '💪' },
  '05-04': { name: '青年节', greeting: '永远年轻，永远热泪盈眶', emoji: '🔥' },
  '06-01': { name: '儿童节', greeting: '愿你永葆童心', emoji: '🎈' },
  '06-18': { name: '父亲节', greeting: '父爱如山，感恩有你', emoji: '👔' },
  '09-10': { name: '教师节', greeting: '感谢每一位老师的付出', emoji: '📚' },
  '10-01': { name: '国庆节', greeting: '祖国生日快乐！', emoji: '🇨🇳' },
  '10-31': { name: '万圣节', greeting: 'Trick or Treat!', emoji: '🎃' },
  '11-11': { name: '双十一', greeting: '购物节快乐，钱包还好吗？', emoji: '🛒' },
  '12-21': { name: '冬至', greeting: '冬至大如年，记得吃饺子', emoji: '🥟' },
  '12-22': { name: '冬至', greeting: '冬至大如年，记得吃饺子', emoji: '🥟' },
  '12-23': { name: '圣诞季', greeting: '圣诞将至，愿你快乐', emoji: '🎄' },
  '12-24': { name: '平安夜', greeting: '平安喜乐', emoji: '🎄' },
  '12-25': { name: '圣诞节', greeting: 'Merry Christmas!', emoji: '🎅' },
  '12-31': { name: '跨年夜', greeting: '新年倒计时！', emoji: '🎆' },
};

// 检查是否是节日
const getHoliday = () => {
  const now = new Date();
  const key = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return HOLIDAYS[key] || null;
};

// 获取今天是一年中的第几天
const getDayOfYear = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
};

// 获取今日一言（基于日期的伪随机，同一天显示相同的句子）
const getDailyQuote = () => {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const index = seed % DAILY_QUOTES.length;
  return DAILY_QUOTES[index];
};

// 计算下班倒计时
const getOffWorkCountdown = () => {
  const now = new Date();
  const day = now.getDay();

  // 周末不显示
  if (day === 0 || day === 6) return null;

  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeValue = hour + minute / 60;

  // 还没上班或已经下班
  if (timeValue < 8.5 || timeValue >= 18) return null;

  // 计算距离18:00的时间
  const offWorkTime = new Date(now);
  offWorkTime.setHours(18, 0, 0, 0);

  const diff = offWorkTime.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return { hours, minutes };
};

// 计算周末倒计时
const getWeekendCountdown = () => {
  const now = new Date();
  const day = now.getDay();

  // 周末不显示
  if (day === 0 || day === 6) return null;

  // 计算距离周六的天数
  const daysUntilWeekend = 6 - day;

  return daysUntilWeekend;
};

// 天气信息类型
interface WeatherInfo {
  temp: string;
  desc: string;
  icon: 'sun' | 'cloud' | 'rain' | 'snow';
  city: string;
}

// 获取天气图标
const getWeatherIcon = (code: string) => {
  const codeNum = parseInt(code);
  if (codeNum >= 200 && codeNum < 300) return 'rain'; // 雷暴
  if (codeNum >= 300 && codeNum < 600) return 'rain'; // 雨
  if (codeNum >= 600 && codeNum < 700) return 'snow'; // 雪
  if (codeNum >= 700 && codeNum < 800) return 'cloud'; // 雾霾
  if (codeNum === 800) return 'sun'; // 晴
  return 'cloud'; // 多云
};

// 业务模块卡片 - 钻取式架构
const BUSINESS_MODULES = [
  {
    id: 'media',
    title: '新媒体运营',
    description: '内容采集、发布管理、数据分析',
    icon: Video,
    color: 'from-pink-500 to-rose-600',
    link: '/media',
    stats: {
      label: '平台运营',
      value: '7个',
      subLabel: '今日发布',
      subValue: '3条'
    }
  },
  {
    id: 'ai',
    title: 'AI 能力中心',
    description: 'AI 员工、视频生成、自动化工作流',
    icon: Sparkles,
    color: 'from-violet-500 to-purple-600',
    link: '/ai',
    stats: {
      label: 'AI 员工',
      value: '8个',
      subLabel: '视频生成',
      subValue: '3次'
    }
  },
  {
    id: 'data',
    title: '数据中心',
    description: '跨平台数据分析、趋势洞察',
    icon: BarChart3,
    color: 'from-blue-500 to-cyan-600',
    link: '/data',
    stats: {
      label: '播放量',
      value: '1.2M',
      subLabel: '互动率',
      subValue: '5%'
    }
  },
  {
    id: 'system',
    title: '系统监控',
    description: '服务状态、任务执行、实时日志',
    icon: Activity,
    color: 'from-green-500 to-emerald-600',
    link: '/system',
    stats: {
      label: '服务状态',
      value: '正常',
      subLabel: '运行任务',
      subValue: '5个'
    }
  }
];


interface Task {
  id: string;
  platform: string;
  status: 'running' | 'success' | 'failed';
  startTime: Date;
  message?: string;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // 获取 Dashboard 实时统计数据
  useEffect(() => {
    const fetchStats = async () => {
      try {
        setStatsLoading(true);
        const stats = await dashboardApi.fetchDashboardStats();
        setDashboardStats(stats);
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
    // 每 30 秒刷新一次
    const timer = setInterval(fetchStats, 30000);
    return () => clearInterval(timer);
  }, []);

  // 节日检测
  const holiday = useMemo(() => getHoliday(), []);
  const dailyQuote = useMemo(() => getDailyQuote(), []);

  // 倒计时状态（每分钟更新）
  const [offWorkCountdown, setOffWorkCountdown] = useState(getOffWorkCountdown());
  const [weekendCountdown] = useState(getWeekendCountdown());
  const [weather, setWeather] = useState<WeatherInfo | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setOffWorkCountdown(getOffWorkCountdown());
    }, 60000); // 每分钟更新
    return () => clearInterval(timer);
  }, []);

  // 获取天气（使用 wttr.in 免费 API - 西安）
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const res = await fetch("https://wttr.in/Xi'an?format=j1");
        if (res.ok) {
          const data = await res.json();
          const current = data.current_condition?.[0];
          if (current) {
            setWeather({
              temp: current.temp_C,
              desc: current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知',
              icon: getWeatherIcon(current.weatherCode),
              city: '西安'
            });
          }
        }
      } catch (e) {
        console.log('天气获取失败', e);
      }
    };
    fetchWeather();
    // 每30分钟更新一次天气
    const weatherTimer = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(weatherTimer);
  }, []);

  const getDynamicGreeting = () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const day = now.getDay();
    const timeValue = hour + minute / 60;

    // 节日优先
    if (holiday) {
      return {
        greeting: `${holiday.emoji} ${holiday.name}快乐`,
        subtitle: holiday.greeting,
        isHoliday: true
      };
    }

    // 周末
    if (day === 0 || day === 6) {
      const weekendMessages = [
        { greeting: '周末好', subtitle: '难得休息，还惦记着工作？' },
        { greeting: '嘿', subtitle: '周末也来看看，真敬业' },
        { greeting: '周末愉快', subtitle: '适当放松，下周继续冲' },
      ];
      return weekendMessages[Math.floor(Math.random() * weekendMessages.length)];
    }

    // 工作日
    const dayNames = ['', '周一', '周二', '周三', '周四', '周五'];
    const dayName = dayNames[day];

    // 早上 8:30 前
    if (timeValue < 8.5) {
      const earlyMessages = [
        { greeting: '早', subtitle: '来得挺早，给自己倒杯咖啡吧' },
        { greeting: '早安', subtitle: '一日之计在于晨，今天也要加油' },
        { greeting: '早上好', subtitle: '早起的鸟儿有虫吃' },
      ];
      return earlyMessages[Math.floor(Math.random() * earlyMessages.length)];
    }

    // 上午工作时间 8:30-12:00
    if (timeValue < 12) {
      const morningMessages = [
        { greeting: '上午好', subtitle: '状态不错，继续保持' },
        { greeting: '早上好', subtitle: `${dayName}，开工大吉` },
        { greeting: 'Hi', subtitle: '上午的效率最高，抓紧干活' },
      ];
      if (day === 1) {
        morningMessages.push({ greeting: '周一好', subtitle: '新的一周，新的开始' });
      }
      return morningMessages[Math.floor(Math.random() * morningMessages.length)];
    }

    // 午休 12:00-13:30
    if (timeValue < 13.5) {
      const lunchMessages = [
        { greeting: '中午好', subtitle: '该吃饭啦，别饿着自己' },
        { greeting: '午安', subtitle: '吃完饭记得休息一下' },
        { greeting: 'Hi', subtitle: '午饭时间，补充能量' },
      ];
      return lunchMessages[Math.floor(Math.random() * lunchMessages.length)];
    }

    // 下午工作时间 13:30-18:00
    if (timeValue < 18) {
      const afternoonMessages = [
        { greeting: '下午好', subtitle: '下午茶时间到了吗？' },
        { greeting: 'Hey', subtitle: '下午也要保持专注哦' },
        { greeting: '下午好', subtitle: '离下班又近了一步' },
      ];
      if (day === 5 && timeValue > 16) {
        afternoonMessages.push({ greeting: '周五下午', subtitle: '快周末了，再坚持一下！' });
      }
      return afternoonMessages[Math.floor(Math.random() * afternoonMessages.length)];
    }

    // 下班后 18:00-21:00
    if (timeValue < 21) {
      const eveningMessages = [
        { greeting: '晚上好', subtitle: '辛苦一天了，注意休息' },
        { greeting: 'Hey', subtitle: '下班了还在忙？别太累' },
        { greeting: '晚上好', subtitle: '今天也辛苦啦' },
      ];
      return eveningMessages[Math.floor(Math.random() * eveningMessages.length)];
    }

    // 深夜 21:00+
    const nightMessages = [
      { greeting: '夜猫子', subtitle: '这么晚还在忙，注意身体啊' },
      { greeting: '深夜好', subtitle: '熬夜伤身，早点休息吧' },
      { greeting: 'Hi', subtitle: '这个点了，明天再说？' },
    ];
    return nightMessages[Math.floor(Math.random() * nightMessages.length)];
  };

  const greeting = getDynamicGreeting();

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 欢迎区域 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-800 dark:text-white mb-2">
              {greeting.greeting}，{user?.name}
            </h1>
            <p className="text-slate-500 dark:text-slate-400">
              {greeting.subtitle}
            </p>
          </div>
          <div className="hidden md:flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-[0_4px_16px_-2px_rgba(0,0,0,0.12)] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
            <Clock className="w-5 h-5 text-blue-500" />
            <div className="text-right">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {new Date().toLocaleDateString('zh-CN', {
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long'
                })}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {new Date().getFullYear()}年第{getDayOfYear()}天
              </div>
            </div>
          </div>
        </div>

        {/* 倒计时 + 天气 + 每日一言 - 立体胶囊风格 */}
        <div className="flex flex-wrap gap-3 mb-6">
          {/* 天气 */}
          {weather && (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.1)] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
              {weather.icon === 'sun' && <Sun className="w-4 h-4 text-amber-500" />}
              {weather.icon === 'cloud' && <Cloud className="w-4 h-4 text-slate-400" />}
              {weather.icon === 'rain' && <CloudRain className="w-4 h-4 text-blue-500" />}
              {weather.icon === 'snow' && <CloudSnow className="w-4 h-4 text-cyan-400" />}
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {weather.city} <span className="font-medium text-slate-800 dark:text-white">{weather.temp}°C</span> {weather.desc}
              </span>
            </div>
          )}

          {/* 下班倒计时 */}
          {offWorkCountdown && (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.1)] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
              <Timer className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-slate-600 dark:text-slate-300">
                距离下班还有 <span className="font-medium text-slate-800 dark:text-white">{offWorkCountdown.hours}小时{offWorkCountdown.minutes}分钟</span>
              </span>
            </div>
          )}

          {/* 周末倒计时 */}
          {weekendCountdown !== null && weekendCountdown > 0 && (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.1)] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
              <PartyPopper className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-slate-600 dark:text-slate-300">
                距离周末还有 <span className="font-medium text-slate-800 dark:text-white">{weekendCountdown}天</span>
              </span>
            </div>
          )}

          {/* 每日一言 */}
          <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 shadow-[0_2px_12px_-2px_rgba(0,0,0,0.1)] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
            <Quote className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {dailyQuote.text}
              <span className="text-slate-400 dark:text-slate-500 ml-1">—— {dailyQuote.author}</span>
            </span>
          </div>
        </div>

        {/* 数据概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="今日发布"
            value={dashboardStats?.todayPublished.value ?? 0}
            delta={dashboardStats?.todayPublished.delta ?? 0}
            icon={Send}
            color="blue"
            subtitle="较昨日"
            loading={statsLoading}
            index={0}
          />
          <StatCard
            title="待处理任务"
            value={dashboardStats?.pendingTasks.value ?? 0}
            icon={ClipboardList}
            color="purple"
            subtitle="等待发布"
            loading={statsLoading}
            index={1}
          />
          <StatCard
            title="活跃账号"
            value={dashboardStats?.activeAccounts.value ?? 0}
            delta={dashboardStats?.activeAccounts.delta ?? 0}
            icon={Users}
            color="green"
            subtitle="登录有效"
            loading={statsLoading}
            index={2}
          />
          <StatCard
            title="AI 执行"
            value={dashboardStats?.aiExecutions.value ?? 0}
            delta={dashboardStats?.aiExecutions.delta ?? 0}
            icon={Bot}
            color="orange"
            subtitle="今日任务"
            loading={statsLoading}
            index={3}
          />
        </div>
      </div>

      {/* 业务模块 - 钻取式入口 */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">业务总览</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {BUSINESS_MODULES.filter(m => m && m.icon).map((module) => {
            const Icon = module.icon;
            return (
              <a
                key={module.id}
                href={module.link}
                className="group relative bg-white dark:bg-slate-800 rounded-2xl shadow-[0_4px_24px_-2px_rgba(0,0,0,0.12),0_2px_8px_-2px_rgba(0,0,0,0.08)] hover:shadow-[0_15px_40px_-10px_rgba(52,103,214,0.25)] transition-all duration-300 overflow-hidden border border-slate-200 dark:border-slate-700 shimmer-card spring-hover"
              >
                {/* 渐变背景 */}
                <div className={`absolute inset-0 bg-gradient-to-br ${module.color} opacity-0 group-hover:opacity-[0.08] dark:group-hover:opacity-[0.15] transition-opacity duration-300`}></div>

                <div className="relative p-7">
                  {/* 图标 + 标题 */}
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`bg-gradient-to-br ${module.color} rounded-xl p-3 shadow-lg ring-4 ring-white/20 dark:ring-slate-700/50 group-hover:shadow-xl group-hover:scale-110 transition-transform duration-300`}
                    >
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  {/* 模块标题 */}
                  <h3 className="text-xl font-semibold text-slate-800 dark:text-white mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300">
                    {module.title}
                  </h3>

                  {/* 模块描述 */}
                  <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed mb-4">
                    {module.description}
                  </p>

                  {/* 汇总数据 */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                      <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{module.stats.label}</div>
                      <div className="text-lg font-bold text-slate-800 dark:text-white">{module.stats.value}</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                      <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{module.stats.subLabel}</div>
                      <div className="text-lg font-bold text-slate-800 dark:text-white">{module.stats.subValue}</div>
                    </div>
                  </div>

                  {/* 查看详情箭头 */}
                  <div className="flex items-center text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all duration-300">
                    查看详情 <span className="ml-1 group-hover:translate-x-2 transition-transform duration-300">→</span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* 最近活动 */}
      {tasks.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] hover:shadow-lg transition-all duration-300 border border-slate-200 dark:border-slate-700">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center">
            <Clock className="w-5 h-5 mr-2 text-blue-500" />
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white">最近活动</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {tasks.slice(0, 5).map((task) => (
              <div key={task.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all duration-300">
                <div className="flex items-center space-x-4">
                  <TaskStatusIcon status={task.status} />
                  <div>
                    <p className="font-medium text-slate-800 dark:text-white">{task.platform} 数据采集</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {task.startTime.toLocaleTimeString('zh-CN')}
                      {task.message && ` - ${task.message}`}
                    </p>
                  </div>
                </div>
                <TaskStatusBadge status={task.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 数字计数动画 Hook
function useCountUp(end: number, duration: number = 1500) {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    startTimeRef.current = null;
    countRef.current = 0;

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function for smooth deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentCount = Math.floor(easeOut * end);

      if (currentCount !== countRef.current) {
        countRef.current = currentCount;
        setCount(currentCount);
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setCount(end);
      }
    };

    requestAnimationFrame(animate);
  }, [end, duration]);

  return count;
}

// 统计卡片组件 - 计数动画 + 玻璃拟态效果
function StatCard({
  title,
  value,
  delta,
  icon: Icon,
  color,
  subtitle,
  loading = false,
  index = 0
}: {
  title: string;
  value: number | string;
  delta?: number;
  icon: any;
  color: string;
  subtitle?: string;
  loading?: boolean;
  index?: number;
}) {
  // 解析数字值用于计数动画
  const numericValue = typeof value === 'number' ? value : parseInt(String(value).replace(/[^0-9]/g, '')) || 0;
  const animatedValue = useCountUp(loading ? 0 : numericValue, 1000 + index * 150);
  const displayValue = typeof value === 'string' && value.includes('+')
    ? `${animatedValue}+`
    : animatedValue;

  const colorClasses = {
    blue: 'bg-gradient-to-br from-blue-500 to-blue-600',
    purple: 'bg-gradient-to-br from-indigo-500 to-indigo-600',
    green: 'bg-gradient-to-br from-sky-500 to-cyan-600',
    orange: 'bg-gradient-to-br from-violet-500 to-purple-600'
  };

  const glowColors = {
    blue: 'shadow-blue-500/30',
    purple: 'shadow-indigo-500/30',
    green: 'shadow-cyan-500/30',
    orange: 'shadow-purple-500/30'
  };

  // 渲染变化指示器
  const renderDelta = () => {
    if (delta === undefined || delta === 0) return null;

    const isPositive = delta > 0;
    return (
      <div className={`flex items-center gap-0.5 text-xs font-medium ${
        isPositive ? 'text-green-500' : 'text-red-500'
      }`}>
        {isPositive ? (
          <TrendingUp className="w-3 h-3" />
        ) : (
          <TrendingDown className="w-3 h-3" />
        )}
        <span>{isPositive ? '+' : ''}{delta}</span>
      </div>
    );
  };

  return (
    <div
      className="group relative bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700/60 overflow-hidden card-reveal tilt-card cursor-default shadow-[0_4px_16px_-2px_rgba(0,0,0,0.08)] hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.12)] transition-all duration-300"
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* 玻璃拟态光效 */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent dark:from-white/5 pointer-events-none" />

      {/* 悬停渐变背景 */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 dark:from-blue-500/10 dark:to-cyan-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative tilt-card-content">
        <div className="flex items-center justify-between mb-3">
          <div className={`${colorClasses[color as keyof typeof colorClasses]} ${glowColors[color as keyof typeof glowColors]} rounded-xl p-2.5 shadow-lg group-hover:scale-110 group-hover:shadow-xl transition-all duration-300`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          {/* 变化指示器或加载动画 */}
          {loading ? (
            <div className="w-4 h-4 border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 rounded-full animate-spin" />
          ) : (
            renderDelta() || (
              <div className="flex items-end gap-0.5 h-5 opacity-50 group-hover:opacity-80 transition-opacity">
                {[40, 65, 45, 80, 100].map((height, i) => (
                  <div
                    key={i}
                    className="w-1 rounded-full bg-gradient-to-t from-blue-500/60 to-blue-300/30 dark:from-sky-400/60 dark:to-sky-300/30 group-hover:scale-y-110 transition-transform duration-300"
                    style={{ height: `${height}%`, transitionDelay: `${i * 30}ms` }}
                  />
                ))}
              </div>
            )
          )}
        </div>
        <div className="text-2xl font-bold text-slate-800 dark:text-white mb-0.5 counter-number">
          {loading ? '-' : displayValue}
        </div>
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{title}</div>
        {subtitle && delta !== undefined && delta !== 0 && (
          <div className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</div>
        )}
        {subtitle && (delta === undefined || delta === 0) && (
          <div className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

// 任务状态图标
function TaskStatusIcon({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'running':
      return <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>;
    case 'success':
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    case 'failed':
      return <div className="h-5 w-5 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xs font-bold">!</div>;
  }
}

// 任务状态徽章
function TaskStatusBadge({ status }: { status: Task['status'] }) {
  const badges = {
    running: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800'
  };
  const labels = {
    running: '进行中',
    success: '成功',
    failed: '失败'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badges[status]}`}>
      {labels[status]}
    </span>
  );
}
