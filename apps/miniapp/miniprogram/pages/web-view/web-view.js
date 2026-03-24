Page({
  data: {
    url: '',
    title: '文章详情'
  },
  
  onLoad: function(options) {
    if (options.url) {
      const decodedUrl = decodeURIComponent(options.url);
      
      this.setData({
        url: decodedUrl
      });
      
      // 提取并设置页面标题
      if (options.title) {
        this.setData({
          title: decodeURIComponent(options.title)
        });
        wx.setNavigationBarTitle({
          title: decodeURIComponent(options.title)
        });
      }
    } else {
      wx.showToast({
        title: '无效的链接',
        icon: 'none'
      });
      
      // 延迟返回
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },
  
  // 页面加载错误处理
  onWebViewError: function(e) {
    console.error('WebView加载错误', e.detail);
    wx.showToast({
      title: '加载页面失败，请稍后再试',
      icon: 'none'
    });
  }
}); 