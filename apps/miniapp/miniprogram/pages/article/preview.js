// pages/article/preview.js
Page({
  data: {
    article: null,
    isLoading: true
  },

  onLoad: function(options) {
    // 从本地存储获取预览文章
    this.getPreviewArticle();
  },

  // 获取预览文章信息
  getPreviewArticle() {
    wx.getStorage({
      key: 'previewArticle',
      success: res => {
        console.log('获取预览文章成功', res);
        
        this.setData({
          article: res.data,
          isLoading: false
        });
      },
      fail: err => {
        console.error('获取预览文章失败', err);
        this.setData({ isLoading: false });
        
        wx.showToast({
          title: '获取预览内容失败',
          icon: 'none'
        });
        
        // 延迟返回
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      }
    });
  },

  // 返回编辑页面
  goBack() {
    wx.navigateBack();
  },

  // 处理图片点击预览
  previewImage(e) {
    const src = e.currentTarget.dataset.src;
    if (src) {
      wx.previewImage({
        current: src,
        urls: [src]
      });
    }
  }
}) 