// pages/article-list/article-list.js
Page({

  /**
   * Page initial data
   */
  data: {
    articles: [],
    isLoading: true
  },

  /**
   * Lifecycle function--Called when page load
   */
  onLoad(options) {
    // 获取文章列表
    this.getArticles();
  },

  /**
   * Lifecycle function--Called when page is initially rendered
   */
  onReady() {

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
    // 下拉刷新
    this.getArticles();
    wx.stopPullDownRefresh();
  },

  /**
   * Called when page reach bottom
   */
  onReachBottom() {

  },

  /**
   * Called when user click on the top right corner to share
   */
  onShareAppMessage() {

  },

  // 获取文章列表
  getArticles: function () {
    this.setData({ 
      isLoading: true
    });

    // 调用云函数获取文章列表
    wx.cloud.callFunction({
      name: 'getRecommendArticles',
      data: { limit: 20 },
      success: res => {
        console.log('获取文章列表成功', res);
        if (res.result && res.result.success && res.result.data) {
          this.setData({
            articles: res.result.data,
            isLoading: false
          });
        } else {
          this.setData({ isLoading: false });
        }
      },
      fail: err => {
        console.error('获取文章列表失败', err);
        this.setData({ isLoading: false });
        
        // 显示错误提示
        wx.showToast({
          title: '获取文章失败，请稍后再试',
          icon: 'none',
          duration: 2000
        });
      }
    });
  },

  // 跳转到文章详情
  goToDetail: function (e) {
    const url = e.currentTarget.dataset.url;
    const id = e.currentTarget.dataset.id;
    
    if (url) {
      wx.navigateTo({
        url: `/pages/web-view/web-view?url=${encodeURIComponent(url)}`
      });
    } else if (id) {
      wx.navigateTo({
        url: `/pages/article-detail/article-detail?id=${id}`
      });
    }
  }
})