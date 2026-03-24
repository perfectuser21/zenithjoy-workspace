// pages/article-detail/article-detail.js
Page({

  /**
   * Page initial data
   */
  data: {
    article: null,
    isLoading: true,
    error: null
  },

  /**
   * Lifecycle function--Called when page load
   */
  onLoad(options) {
    const { id, url } = options;
    
    if (url) {
      // 外部链接用web-view打开
      wx.redirectTo({
        url: `/pages/web-view/web-view?url=${encodeURIComponent(url)}`
      });
      return;
    }
    
    if (id) {
      // 获取文章详情
      this.getArticleDetail(id);
    } else {
      this.setData({
        isLoading: false,
        error: '无效的文章ID'
      });
    }
  },

  /**
   * Lifecycle function--Called when page is initially rendered
   */
  onReady() {
    // 设置默认标题
    wx.setNavigationBarTitle({
      title: '文章详情'
    });
  },

  /**
   * Lifecycle function--Called when page show
   */
  onShow() {

  },

  /**
   * Lifecycle function--Called when page hide
   */
  onHide() {

  },

  /**
   * Lifecycle function--Called when page unload
   */
  onUnload() {

  },

  /**
   * Page event handler function--Called when user drop down
   */
  onPullDownRefresh() {
    // 下拉刷新，重新加载文章
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    const options = currentPage.options;
    
    if (options.id) {
      this.setData({
        isLoading: true,
        error: null,
        article: null
      });
      this.getArticleDetail(options.id);
    }
    
    wx.stopPullDownRefresh();
  },

  /**
   * Called when page reach bottom
   */
  onReachBottom() {
    // 可以在这里加载相关推荐文章
  },

  /**
   * Called when user click on the top right corner to share
   */
  onShareAppMessage() {
    const article = this.data.article;
    if (article) {
      return {
        title: article.title,
        path: `/pages/article-detail/article-detail?id=${article.id}`,
        imageUrl: article.cover || '/images/default-share.png'
      };
    }
    return {
      title: 'AI智能助手 - 精彩文章',
      path: '/pages/index/index'
    };
  },

  // 返回首页
  goBack: function() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  // 获取文章详情
  getArticleDetail: function(id) {
    // 实际项目中应该调用云函数获取文章详情
    wx.cloud.callFunction({
      name: 'getArticleDetail',
      data: { id },
      success: res => {
        if (res.result && res.result.data) {
          this.setData({
            article: res.result.data,
            isLoading: false
          });
          
          // 设置标题
          wx.setNavigationBarTitle({
            title: res.result.data.title || '文章详情'
          });
        } else {
          // 如果云函数调用成功但没有返回数据，使用模拟数据
          this.setMockArticle(id);
        }
      },
      fail: err => {
        console.error('获取文章详情失败', err);
        // 如果云函数调用失败，使用模拟数据
        this.setMockArticle(id);
      }
    });
  },
  
  // 设置模拟文章数据
  setMockArticle: function(id) {
    // 模拟文章数据
    const mockArticle = {
      id: id,
      title: "AI技术在日常生活中的应用",
      content: "<h1>AI技术在日常生活中的应用</h1><p>随着人工智能技术的快速发展，AI已经深入到我们生活的方方面面。从智能手机到智能家居，从个人助手到自动驾驶汽车，AI正在改变我们的生活方式。</p><h2>智能手机中的AI</h2><p>现代智能手机中集成了各种AI功能，包括语音助手、拍照优化、面部识别等。这些功能依靠机器学习算法分析用户行为，提供个性化的服务。</p><h2>智能家居</h2><p>AI使家居设备变得智能化，可以通过语音控制灯光、温度和安防系统。智能家居系统还可以学习用户习惯，自动调整设置，提高能源效率。</p><h2>个人AI助手</h2><p>Siri、Alexa和Google Assistant等个人助手可以回答问题、设置提醒、播放音乐等。随着技术进步，这些助手变得越来越智能，能够理解复杂的指令和上下文。</p><h2>未来展望</h2><p>随着技术的不断进步，AI在日常生活中的应用将更加广泛。从健康监测到个性化教育，AI将为我们创造更便捷、更高效的生活方式。</p>",
      cover: "/images/default-cover.png",
      date: "2024-01-20",
      author: "AI技术团队",
      tags: ["AI应用", "生活科技"]
    };
    
    this.setData({
      article: mockArticle,
      isLoading: false
    });
    
    // 设置标题
    wx.setNavigationBarTitle({
      title: mockArticle.title
    });
  }
})