import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Image, X, ChevronLeft, ChevronRight } from 'lucide-react';

// ============ 数据 ============

type Tag = '认知' | '社交' | '效率';

interface WorkItem {
  num: number;
  title: string;
  body: string;
  tags: Tag[];
  imageUrl: string;
}

const TITLES: Record<number, string> = {
  1: '别把存档当成学会', 2: '礼貌的暴政', 3: '穷忙的快感', 4: '装备党的陷阱',
  5: '等待被授权', 6: '完美的备忘录是墓碑', 7: '好说话是最廉价的标签', 8: '装备这种安慰剂',
  9: '停止你的过度拯救', 10: '收藏夹里的尸体', 11: '把那个粗糙的版本发出去', 12: '这一小时你在互偷时间',
  13: '收藏夹是认知的坟墓', 14: '嫉妒是一张地图', 15: '敢于失联', 16: '完美主义的伪装',
  17: '隐形的情绪账本', 18: '深夜的电子麻醉', 19: '廉价的秒回', 20: '嫉妒是精准的导航',
  22: '社交的本质是价值交换', 23: '收藏从未等于学习', 24: '平庸的完成品胜过完美的半成品',
  25: '刷手机不是休息', 26: '职场伪专业', 27: '知识松鼠症', 28: '廉价的礼貌',
  29: '装备党的拖延', 30: '秒回的陷阱', 32: '人脉的误区',
  33: '完美主义的拖延', 34: '定价的博弈', 35: '选择的瘫痪',
};

const BODIES: Record<number, string> = {
  1: '你的收藏夹里躺着几十篇干货，除了点击收藏的那一秒，你再也没打开过它们。你甚至产生了一种错觉，觉得只要把知识放进文件夹，它就流进了你的脑子。别骗自己了，收藏往往不是为了学习，而是为了缓解我怕错过的焦虑。囤积的信息不是知识，是精神脂肪。如果这篇内容不能让你在24小时内改变一个微小的行动，现在就把它删掉，或者别点开它。',
  2: '你明明不想去那个聚局，还是笑着说了好，挂断电话那一刻，你的胃部一阵收缩。你以为这是高情商，其实这只是廉价的讨好。真正的友善是有锋芒的，而你现在的温和，只是因为你不敢承受别人失望的眼神。没有边界感的礼貌，本质上是穿了西装的懦弱。除非你敢说不，否则你的是在成年人的交易市场上毫无价值。',
  3: '过去十分钟里，你刷新了三次邮箱，即便并没有新邮件提示音。你渴望出现一个紧急的小问题让你去解决，这样你就不用面对那个真正困难的大项目。这种伪忙碌是你给自己注射的麻醉剂，让你在琐碎中获得虚假的成就感。回复邮件不是工作，那是最高级的拖延。真正的生产力，是敢于让无关紧要的火烧一会，把自己锁在房间里搞定那件唯一重要的事。',
  4: '你花了三个晚上研究哪款跑鞋减震最好，却已经半年没有跑过一公里。你觉得买了全套的露营装备，你就拥有了那种生活方式，但它们现在正在储藏室积灰。消费主义最成功的洗脑，就是让你以为购买工具等于掌握技能。你在寻找完美的开始条件，但那个条件永远不会存在。把信用卡收起来，穿上你那双旧鞋出门，业余选手才挑工具，高手只看老茧。',
  5: '会议室出现了三秒钟的尴尬沉默，你明明有答案，却下意识地看向了老板。你在等一个人点头，好像需要一张许可证才能发表你的见解。但在这个草台班子的世界里，从来没有人会正式把权力交接到你手上。等待准备好是一个伪命题，那一天永远不会来。权威不是别人给的头衔，而是你在混乱中敢于率先打破沉默的那一刻抢来的。',
  6: '你盯着那个刚建好的Notion页面，字体调了三遍，标签分了四类，但正文一个字没写。你觉得自己正在深度工作，但身体很诚实——你在等咖啡凉下来，好有借口再去倒一杯。这种精致的整理癖不是自律，而是对困难的高级逃避。过度准备是行动的麻醉剂，完美的计划表往往是项目的墓碑。关掉排版工具，用最简陋的记事本写完那段最难的话。乱，才说明你开始了。',
  7: '当同事把第三个本来不属于你的文档丢过来时，你明明想摔键盘，嘴上却习惯性滑出一句好的没问题。你以为这是高情商或攒人品，实际上对方转头就忘了你的名字，只记得你是一个好用的工具。在职场食物链里，如果你没有长出拒绝的刺，你的帮忙就一文不值。没有边界的友善，是在邀请别人通过践踏你来节省成本。',
  8: '下单那台两万块的相机时，你脑补的是自己在西藏拍大片的背影。但三个月过去了，它唯一的用途是在防潮箱里吃灰，和你上一张健身卡一样。你买的不是工具，是我已经是个摄影师的幻觉。消费是获得技能的最大阻力，因为它提前透支了获得成就感的快乐。只要刷了卡，你的大脑就误以为任务已经完成了。',
  9: '朋友第十次向你抱怨同一个渣男，你还在掏心掏肺地列举分手策略，甚至想帮她拟短信。你以为自己在救她，其实她只是需要一个垃圾桶，而你是个不仅免费还要自己分类的清洁工。试图叫醒一个装睡的人，不是慈悲，是一种控制欲。未经请求的建议，往往是你自己在刷存在感。',
  10: '手指按下收藏的那一秒，多巴胺让你觉得这知识已经是你的了。不管是干货文章还是健身视频，进了收藏夹就等于进了火葬场，你永远不会再点开。囤积信息的快感，是在麻痹你大脑原本的饥饿感。这种只进不出的学习，叫知识肥胖症。你以为你在成长，其实你只是在发炎。',
  11: '盯着那张PPT的第三页看了两小时，字体调大又调小。你觉得自己是在打磨，其实你只是在恐惧被评判。把那个粗糙的版本发出去。现在。市场上没有人会对你的完美主义买单，他们只为看见买单。被骂的草稿，胜过抽屉里的杰作。',
  12: '日历上又多了一个随便聊聊的咖啡局。你不好意思拒绝，觉得这是在积累人脉。看着对方漫无目的寒暄，残酷的事实是：在这个房间里，如果不谈具体的痛点和解决方案，你们就是在互偷生命。真正的连接发生在共同解决麻烦的战壕里，而不是礼貌的咖啡馆。',
  13: '手指按下收藏的那一秒，你获得了一种虚假的满足感。你骗自己今晚会读，但那个红点只会烂在列表里，变成数字灰尘。这不是学习，这是知识囤积癖。除非你能立刻用这篇内容写出一段话，或者改变手头的一个动作，否则现在就把它删了。',
  14: '看到同行发出的战报，你的拇指不仅没有点赞，胃里反而抽搐了一下。你觉得自己心胸狭窄？别自责。那个刺痛感是你最诚实的数据。它在精准地告诉你，你到底渴望什么。嫉妒不是一种罪恶，它是一张地图。别滑走，盯着那个让你难受的成就看，然后承认：那就是我下一个要拿下的山头。',
  15: '周六上午在公园，手里还攥着手机回消息。你以为这叫敬业，其实这叫软弱。这种半工作半休息的状态是最低效的耗电——既毁了当下的陪伴，也没产出任何质量。随时在线不是能力，敢于失联才是顶级能力。把手机关机扔在车里两小时。',
  16: '你把显示器角度调正，把键盘下的灰尘擦掉，最后把咖啡杯的手柄精确地转到右手边。你深吸一口气，告诉自己这叫工匠精神。别装了。这种过度的仪式感不是为了进入状态，而是为了推迟面对空白文档的恐惧。完美的准备工作，通常是最高级的拖延。',
  17: '对方迟到了半小时，你笑着说完全没关系，我也刚到。挂断电话，你在心里默默给这段关系扣掉了20分。这种隐形记账比当面发火更致命。你以为你在维持体面，实际上你在积累高利贷。当账本爆掉的那天，对方甚至不知道自己错在哪。',
  18: '凌晨02:14，手机再次砸在脸上。眼睛干涩得要命，大拇指却还在机械地上划。你根本没看进去那些视频，你只是不敢放下手机。你不是在放松，你是在进行电子麻醉。你害怕关灯后那一秒的死寂，害怕今天一事无成的失落感在那一刻追上你。',
  19: '周末家庭聚餐，手机震动了一下，你立刻放下刚夹起的筷子回复消息。你觉得自己责任感爆棚，全公司都离不开你。醒醒吧。这不代表你专业，只代表你的时间极其廉价，且缺乏系统化工作的能力。随叫随到是职场底层的标签。',
  20: '看到那个能力不如你的同行在朋友圈晒出了千万融资，你快速划过屏幕，嘴角挤出一句：运气好罢了。但你心里那种被针扎了一下的感觉，骗不了人。嫉妒是你人生最精准的导航仪。它绕过了你的理智，精准地指出了你内心渴望却不敢承认的野心。',
  22: '那是你今晚第五次举起手机扫码，伴随着一声清脆的滴，你觉得又积累了一条人脉。别骗自己了。在回家的地铁上，你其实很清楚：如果你自己不是一个资源，刚才加的所有人，都只是通讯录里的电子尸体。弱者才忙着混圈子，强者只忙着把自己变成诱饵。',
  23: '手指点击收藏图标变黄的那一秒，是你大脑最狡猾的瞬间。那一刻的轻松感是假的，它在欺骗你这知识归我了，从而让你理直气壮地停止思考。收藏夹不是你的知识库，它是你思维懒惰的停尸房。如果不进行能够被反驳的输出，所有的输入都是精神鸦片。',
  24: '光标在空白文档上闪烁了二十分钟，像是在嘲笑你的无能。你迟迟不动手，是因为你想一鸣惊人。别装了，所谓的完美主义，不过是裹着糖衣的怯懦。市场不为你的完美构思买单，只为那个满是漏洞但已经上线的1.0版本付费。',
  25: '手机砸到鼻梁的痛感，是你今晚收到的最后警告。你以为躺着刷视频是放松，大错特错。你的大脑正在以每秒10帧的速度处理垃圾信息，这比你白天写PPT还要累。这不是休息，这是最高强度的认知加班。真正的休息允许无聊，允许没有任何像素进入视网膜。',
  26: '会议室里，对着那张逻辑不通的PPT，你眉头微皱频频点头，笔尖在纸上假装划重点，其实只画了几个圈。你以为这叫专业沉稳，实际上你只是不敢做那个戳破皇帝新衣的人。职场最大的骗局就是情绪稳定。敢于当众暴露冲突，是你不再做工具人的开始。',
  27: '你的微信收藏夹里躺着300篇年度干货，最后一次打开它们，是三个月前手指误触。按下收藏键的那一刻，大脑分泌的多巴胺让你觉得自己学会了，实际上你只是把它们亲手埋进了赛博坟场。停止像松鼠一样囤积。知识不经过你的嘴巴说出来，它就永远是别人的尸体。',
  28: '刚刚那通五分钟的电话里，你下意识说了三次不好意思，尽管那是对方发错了文件。你以为这是高情商的修养，但在对方的潜意识里，这叫安全的可欺负对象。试着把嘴边的抱歉换成谢谢你的耐心。廉价的歉意换不来尊重，带刺的界限感才能让你在成年人的世界里站着说话。',
  29: '购物车里那套2000块的压缩衣到货之前，你绝不会下楼跑一米。你骗自己说这是工欲善其事，实际上你只是爱上了准备开始的幻觉，并在快递路上耗尽了所有热情。真正的改变不需要仪式感。穿上拖鞋直接冲出门，跑五分钟。粗糙的开始胜过精致的意淫。',
  30: '手机屏幕亮起的瞬间，你像巴甫洛夫的实验对象一样，秒回了那条无关紧要的消息。你觉得这叫靠谱，实际上你只是在向全世界宣告：我的时间很廉价，随时可以被插队。关掉通知，晾着他们。真正的大事会打电话，随叫随到那是便利店店员的修养。',
  32: '你今天点了50个建立联系。你以为你在搭桥。但如果你的第一条私信就是推销，你实际上是在烧桥。你的人脉不是用你认识谁来衡量的，而是用谁会接你电话来衡量的。停止连接，开始贡献。如果他们在知道你的名字之前不知道你的价值，你只是他们收件箱里的噪音。',
  33: '你又调整了一下logo。又重写了一遍开头。你告诉自己：我只是标准高。不，你没有。你在躲藏。只要它还进行中，它就不会被评判，不会失败。足够好今天上线，胜过完美永远不上线。市场不为你的潜力或打磨买单。它只为你的产出付费。',
  34: '当客户对价格讨价还价时，你的本能是打折。别这样。当你打折你的费用时，你在打折结果。你在告诉他们：是的，也许我本来就不值那么多。如果你解决的是100万的问题，没人在乎10万的账单。问题不在于价格标签，而在于价值差距。',
  35: '你已经瘫痪了好几周，在选项A和选项B之间反复权衡。你以为如果分析足够多的数据，完美的道路就会亮起来。它不会。一个平庸但快速执行的决定，胜过一个完美但太迟的决定。选择的质量不在于选择本身，而在于选择之后的执行。唯一的坏选择，是站在原地不动。',
};

const TAG_MAP: Record<number, Tag[]> = {
  1: ['认知'], 2: ['社交'], 3: ['效率'], 4: ['认知'],
  5: ['效率'], 6: ['效率'], 7: ['社交'], 8: ['认知'],
  9: ['社交'], 10: ['认知'], 11: ['效率'], 12: ['社交'],
  13: ['认知'], 14: ['认知'], 15: ['效率'], 16: ['效率'],
  17: ['社交'], 18: ['认知'], 19: ['社交'], 20: ['认知'],
  22: ['社交'], 23: ['认知'], 24: ['效率'],
  25: ['认知'], 26: ['社交'], 27: ['认知'], 28: ['社交'],
  29: ['效率'], 30: ['社交'], 32: ['社交'],
  33: ['效率'], 34: ['效率'], 35: ['认知'],
};

// ChatGPT 卡片 33 张（缺 #21 和 #31）
const CARD_NUMS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  22, 23, 24, 25, 26, 27, 28, 29, 30,
  32, 33, 34, 35,
];

const ALL_ITEMS: WorkItem[] = CARD_NUMS.map((num) => ({
  num,
  title: TITLES[num],
  body: BODIES[num] || '',
  tags: TAG_MAP[num] || [],
  imageUrl: `/gallery/chatgpt-cards/${String(num).padStart(2, '0')}_${TITLES[num]}.png`,
}));

// ============ 右侧滑出面板（Notion 风格） ============

function SlidePanel({
  item,
  items,
  onClose,
  onNavigate,
}: {
  item: WorkItem;
  items: WorkItem[];
  onClose: () => void;
  onNavigate: (item: WorkItem) => void;
}) {
  const currentIndex = items.indexOf(item);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowUp' && currentIndex > 0) onNavigate(items[currentIndex - 1]);
      if (e.key === 'ArrowDown' && currentIndex < items.length - 1) onNavigate(items[currentIndex + 1]);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentIndex, items, onClose, onNavigate]);

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* 右侧面板 */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] md:w-[540px] bg-white dark:bg-slate-900 shadow-2xl flex flex-col animate-slide-in-right">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            {currentIndex > 0 && (
              <button
                onClick={() => onNavigate(items[currentIndex - 1])}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <span className="text-xs text-slate-400">
              {currentIndex + 1} / {items.length}
            </span>
            {currentIndex < items.length - 1 && (
              <button
                onClick={() => onNavigate(items[currentIndex + 1])}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {/* 图片 */}
          <div className="p-5">
            <img
              src={item.imageUrl}
              alt={item.title}
              className="w-full rounded-xl shadow-lg"
            />
          </div>

          {/* 标题 + 标签 */}
          <div className="px-5 pb-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {item.title}
            </h2>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-slate-400">#{item.num}</span>
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* 分割线 */}
          <div className="mx-5 border-t border-slate-100 dark:border-slate-800" />

          {/* 正文 */}
          <div className="px-5 py-4">
            <p className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300">
              {item.body}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ============ 懒加载图片 ============

function LazyImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const imgRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className={className}>
      {inView && (
        <img
          src={src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
        />
      )}
      {(!inView || !loaded) && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-xl" />
      )}
    </div>
  );
}

// ============ 主页面 ============

export default function WorksGalleryPage() {
  const [tagFilter, setTagFilter] = useState<Tag | null>(null);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  const filtered = useMemo(() => {
    if (!tagFilter) return ALL_ITEMS;
    return ALL_ITEMS.filter((item) => item.tags.includes(tagFilter));
  }, [tagFilter]);

  const handleCardClick = useCallback((item: WorkItem) => {
    setSelectedItem(item);
  }, []);

  const TAGS: Tag[] = ['认知', '社交', '效率'];

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-white mb-1 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
            <Image className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          作品库
        </h1>
        <p className="text-slate-500 dark:text-slate-400 ml-13">
          {filtered.length} 张 ChatGPT 风格卡片
        </p>
      </div>

      {/* 标签筛选 */}
      <div className="flex gap-2 mb-6">
        {TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              tagFilter === tag
                ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            {tag}
          </button>
        ))}
        {tagFilter && (
          <button
            onClick={() => setTagFilter(null)}
            className="px-3 py-1.5 rounded-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            清除
          </button>
        )}
      </div>

      {/* 卡片网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {filtered.map((item) => (
          <div
            key={item.num}
            onClick={() => handleCardClick(item)}
            className="group cursor-pointer"
          >
            <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 shadow-sm group-hover:shadow-lg transition-all duration-300 group-hover:-translate-y-1">
              <LazyImage
                src={item.imageUrl}
                alt={item.title}
                className="absolute inset-0"
              />
            </div>
            <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
              {item.title}
            </p>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-slate-400 dark:text-slate-500">
          没有匹配的卡片
        </div>
      )}

      {/* Notion 风格右侧滑出面板 */}
      {selectedItem && (
        <SlidePanel
          item={selectedItem}
          items={filtered}
          onClose={() => setSelectedItem(null)}
          onNavigate={setSelectedItem}
        />
      )}
    </div>
  );
}
