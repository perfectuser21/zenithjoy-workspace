// 首页
const app = getApp();

// 避免使用辅助函数，直接定义在代码中
function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

// AI助手类型配置
const AI_BOTS = {
  writer: {
    botId: "7481212266399449139", // agent1
    title: "AI智能写手",
    prompt: "我是智能写手，可以帮您创作高质量的文章、报告、故事等各类文本内容。请告诉我您需要什么类型的文本？"
  },
  content: {
    botId: "7481213430658433034", // agent2
    title: "AI文案工坊",
    prompt: "我是文案工坊，专门为您生成广告文案、产品描述、社交媒体内容等营销文案。请描述您需要的文案类型和目标受众。"
  },
  imagine: {
    botId: "7481213488808099874", // agent3
    title: "AI创意图匠",
    prompt: "我是创意图匠，可以根据您的描述生成图文内容。请告诉我您想要创作什么样的图像？"
  },
  expert: {
    botId: "7481213361658036235", // agent4
    title: "AI智能专家",
    prompt: "我是智能专家，可以回答您在各个领域的专业问题。无论是科技、商业、教育还是其他领域，请随时向我提问。"
  }
};

// 定义首页
Page({
  data: {
    userInfo: {},
    hasUserInfo: false,
    canIUseGetUserProfile: false,
    isLoading: true,
    isEmergency: false,        // 默认不显示应急页面
    isAdmin: false,            // 添加管理员状态标记
    aiTools: [
      { id: 'writer', name: '智能写手', icon: '/images/ai-tools/writer.png', emoji: '' },
      { id: 'content', name: '文案工坊', icon: '/images/ai-tools/content.png', emoji: '' },
      { id: 'imagine', name: '创意图匠', icon: '/images/ai-tools/imagine.png', emoji: '' },
      { id: 'expert', name: '智能专家', icon: '/images/ai-tools/expert.png', emoji: '' }
    ],
    recentChats: [],           // 最近会话列表
    systemInfo: {},            // 系统信息
    statusBarHeight: 20,       // 状态栏高度，默认20px
    navBarHeight: 44,          // 导航栏高度，默认44px
    capsuleButtonInfo: {},     // 胶囊按钮信息
  },

  onLoad: function () {
    console.log('首页 onLoad 开始执行');
    
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    });
    
    if (wx.getUserProfile) {
      this.setData({
        canIUseGetUserProfile: true
      });
    }
    
    // 检查是否有用户信息
    this.checkUserInfo();
    
    // 获取系统信息
    this.getSystemInfo();
    
    // 数据库初始化
    this.initializeDatabase();
    
    // 获取最近会话
    this.getRecentChats();
    
    // 检查管理员状态
    this.checkAdminStatus();
    
    console.log('首页 onLoad 完成');
  },
  
  onReady: function() {
    console.log('首页 onReady 被调用');
  },
  
  onShow: function() {
    console.log('首页 onShow 被调用');
    
    // 每次显示页面都重新获取最近会话
    this.getRecentChats();
  },
  
  onHide: function() {
    console.log('首页 onHide 被调用');
  },
  
  onUnload: function() {
    console.log('首页 onUnload 被调用');
  },
  
  onShareAppMessage: function() {
    return {
      title: 'AI智能助手 - 让人工智能为您服务',
      path: '/pages/index/index'
    };
  },
  
  onShareTimeline: function() {
    return {
      title: 'AI智能助手 - 智能写作、文案创作、图像生成、专家咨询',
      query: ''
    };
  },
  
  onTabItemTap: function(item) {
    console.log('首页 onTabItemTap 被调用', item);
  },
  
  // 获取系统信息
  getSystemInfo: function() {
    try {
      const systemInfo = wx.getSystemInfoSync();
      console.log('系统信息:', systemInfo);
      
      // 获取状态栏和导航栏高度
      let statusBarHeight = systemInfo.statusBarHeight || 20;
      let navBarHeight = 44; // 默认导航栏高度
      
      // 获取胶囊按钮信息
      const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
      
      this.setData({
        systemInfo: systemInfo,
        statusBarHeight: statusBarHeight,
        navBarHeight: navBarHeight,
        capsuleButtonInfo: menuButtonInfo
      });
    } catch (e) {
      console.error('获取系统信息失败:', e);
    }
  },
  
  // 检查用户信息
  checkUserInfo: function() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({
        userInfo: userInfo,
        hasUserInfo: true,
        isLoading: false
      });
    } else {
      this.setData({
        isLoading: false
      });
    }
  },
  
  // 获取用户信息
  getUserProfile: function(e) {
    wx.getUserProfile({
      desc: '用于完善会员资料',
      success: (res) => {
        console.log('获取用户信息成功:', res);
        const userInfo = res.userInfo;
        
        // 保存到本地缓存
        wx.setStorageSync('userInfo', userInfo);
        
        // 更新页面数据
        this.setData({
          userInfo: userInfo,
          hasUserInfo: true
        });
        
        // 保存用户信息到云数据库
        this.saveUserToDatabase(userInfo);
      },
      fail: (err) => {
        console.error('获取用户信息失败:', err);
      }
    });
  },
  
  // 保存用户信息到数据库
  saveUserToDatabase: function(userInfo) {
    wx.cloud.callFunction({
      name: 'userLogin',
      data: {
        userInfo: userInfo
      },
      success: (res) => {
        console.log('保存用户信息成功:', res);
      },
      fail: (err) => {
        console.error('保存用户信息失败:', err);
      }
    });
  },
  
  // 数据库初始化
  initializeDatabase: function() {
    wx.cloud.callFunction({
      name: 'initDatabase',
      success: res => {
        console.log('数据库初始化成功', res);
      },
      fail: err => {
        console.error('数据库初始化失败', err);
      }
    });
  },
  
  // 检查管理员状态
  checkAdminStatus: function() {
    wx.cloud.callFunction({
      name: 'checkAdmin'
    }).then(res => {
      console.log('检查管理员状态:', res);
      if (res.result && res.result.isAdmin) {
        this.setData({
          isAdmin: true
        });
      }
    }).catch(err => {
      console.error('检查管理员状态失败:', err);
      // 即使检查失败，也默认设置为非管理员
      this.setData({
        isAdmin: false
      });
    });
  },
  
  // 打开AI助手会话
  openAIChat: function(e) {
    const { id } = e.currentTarget.dataset;
    const aiBot = AI_BOTS[id];
    
    if (aiBot) {
      // 跳转到聊天页面
      wx.navigateTo({
        url: `/pages/ai-chat/ai-chat?botId=${aiBot.botId}&title=${encodeURIComponent(aiBot.title)}&prompt=${encodeURIComponent(aiBot.prompt)}`
      });
    } else {
      wx.showToast({
        title: '该功能暂未开放',
        icon: 'none'
      });
    }
  },
  
  // 继续最近的会话
  continueChat: function(e) {
    const { id, botid, title } = e.currentTarget.dataset;
    
    if (id && botid) {
      wx.navigateTo({
        url: `/pages/ai-chat/ai-chat?conversationId=${id}&botId=${botid}&title=${encodeURIComponent(title || '智能助手')}`
      });
    }
  },
  
  // 获取最近会话
  getRecentChats: function() {
    // 调用云数据库查询最近会话
    const db = wx.cloud.database();
    db.collection('chats')
      .where({
        _openid: '{openid}' // 使用服务端自动替换的openid
      })
      .orderBy('updateTime', 'desc')
      .limit(5)
      .get()
      .then(res => {
        console.log('获取最近会话成功', res);
        this.setData({
          recentChats: res.data
        });
      })
      .catch(err => {
        console.error('获取最近会话失败', err);
      });
  },
  
  // 跳转到会员中心
  goToMembership: function() {
    wx.navigateTo({
      url: '/pages/membership/membership'
    });
  },
  
  // 重新加载页面
  reloadPage: function() {
    this.setData({
      isEmergency: false
    });
    
    // 重新加载数据
    this.onLoad();
  }
}); 