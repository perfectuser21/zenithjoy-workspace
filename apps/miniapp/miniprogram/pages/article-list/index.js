// pages/article-list/index.js
Page({
  data: {
    articles: [],
    isLoading: true,
    hasMore: true,
    page: 1,
    pageSize: 10
  },

  onLoad: function (options) {
    this.loadArticles();
  },

  onPullDownRefresh: function () {
    this.setData({
      articles: [],
      page: 1,
      hasMore: true,
      isLoading: true
    });
    this.loadArticles();
  },

  onReachBottom: function () {
    if (this.data.hasMore && !this.data.isLoading) {
      this.loadMoreArticles();
    }
  },

  loadArticles: function () {
    wx.cloud.callFunction({
      name: 'getArticles',
      data: {
        action: 'getArticleList',
        page: 1,
        pageSize: this.data.pageSize
      },
      success: res => {
        console.log('获取文章列表成功', res);
        if (res.result && res.result.data) {
          const { data, total } = res.result;
          this.setData({
            articles: data,
            isLoading: false,
            hasMore: data.length < total
          });
        } else {
          this.setData({
            isLoading: false,
            hasMore: false
          });
        }
        wx.stopPullDownRefresh();
      },
      fail: err => {
        console.error('获取文章列表失败', err);
        this.setData({
          isLoading: false,
          hasMore: false
        });
        wx.stopPullDownRefresh();
        wx.showToast({
          title: '获取文章列表失败',
          icon: 'none'
        });
      }
    });
  },

  loadMoreArticles: function () {
    if (this.data.isLoading || !this.data.hasMore) return;
    
    this.setData({
      isLoading: true,
      page: this.data.page + 1
    });

    wx.cloud.callFunction({
      name: 'getArticles',
      data: {
        action: 'getArticleList',
        page: this.data.page,
        pageSize: this.data.pageSize
      },
      success: res => {
        console.log('加载更多文章成功', res);
        if (res.result && res.result.data) {
          const { data, total } = res.result;
          const newArticles = [...this.data.articles, ...data];
          
          this.setData({
            articles: newArticles,
            isLoading: false,
            hasMore: newArticles.length < total
          });
        } else {
          this.setData({
            isLoading: false,
            hasMore: false
          });
        }
      },
      fail: err => {
        console.error('加载更多文章失败', err);
        this.setData({
          isLoading: false,
          page: this.data.page - 1
        });
        wx.showToast({
          title: '加载更多失败',
          icon: 'none'
        });
      }
    });
  },

  goToDetail: function (e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/article-detail/index?id=${id}`
    });
  }
}); 