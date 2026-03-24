Page({
  data: {
    article: null,
    isLoading: true
  },

  onLoad: function (options) {
    const { id } = options;
    if (id) {
      this.loadArticle(id);
    } else {
      this.setData({
        isLoading: false
      });
    }
  },

  loadArticle: function (id) {
    wx.cloud.callFunction({
      name: 'getArticles',
      data: {
        action: 'getArticleById',
        id: id
      },
      success: res => {
        console.log('获取文章详情成功', res);
        if (res.result && res.result.data) {
          this.setData({
            article: res.result.data,
            isLoading: false
          });
        } else {
          this.setData({
            isLoading: false
          });
          wx.showToast({
            title: '文章不存在',
            icon: 'none'
          });
        }
      },
      fail: err => {
        console.error('获取文章详情失败', err);
        this.setData({
          isLoading: false
        });
        wx.showToast({
          title: '获取文章失败',
          icon: 'none'
        });
      }
    });
  },

  copyContent: function () {
    if (this.data.article && this.data.article.content) {
      wx.setClipboardData({
        data: this.data.article.content,
        success: function () {
          wx.showToast({
            title: '已复制',
            icon: 'success'
          });
        }
      });
    }
  }
}); 