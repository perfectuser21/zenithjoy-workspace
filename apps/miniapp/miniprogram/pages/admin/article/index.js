Page({
  data: {
    articles: [],
    isLoading: true,
    isAdmin: false,
    page: 1,
    limit: 10,
    total: 0,
    hasMore: true
  },

  onLoad: function(options) {
    // 检查用户是否是管理员
    this.checkAdminStatus();
    // 获取文章列表
    this.getArticles();
  },

  // 检查管理员状态
  checkAdminStatus() {
    const that = this;
    wx.cloud.callFunction({
      name: 'checkAdmin',
      success: res => {
        console.log('检查管理员状态:', res);
        if (res.result && res.result.isAdmin) {
          that.setData({
            isAdmin: true
          });
        } else {
          // 如果不是管理员，跳转回首页
          wx.showToast({
            title: '无管理权限',
            icon: 'none',
            duration: 2000
          });
          setTimeout(() => {
            wx.switchTab({
              url: '/pages/index/index',
            });
          }, 2000);
        }
      },
      fail: err => {
        console.error('检查管理员状态失败', err);
        wx.showToast({
          title: '权限检查失败',
          icon: 'none'
        });
      }
    });
  },

  // 获取文章列表
  getArticles() {
    const that = this;
    const { page, limit } = this.data;
    
    this.setData({ isLoading: true });
    
    const db = wx.cloud.database();
    db.collection('articles')
      .orderBy('createTime', 'desc')
      .skip((page - 1) * limit)
      .limit(limit)
      .get({
        success: res => {
          console.log('获取文章列表成功', res);
          
          // 获取总数
          db.collection('articles').count({
            success: countRes => {
              const total = countRes.total;
              const hasMore = total > page * limit;
              
              that.setData({
                articles: page === 1 ? res.data : [...that.data.articles, ...res.data],
                isLoading: false,
                total,
                hasMore
              });
            }
          });
        },
        fail: err => {
          console.error('获取文章列表失败', err);
          that.setData({ isLoading: false });
          wx.showToast({
            title: '获取文章失败',
            icon: 'none'
          });
        }
      });
  },

  // 加载更多
  loadMore() {
    if (this.data.hasMore) {
      this.setData({
        page: this.data.page + 1
      }, () => {
        this.getArticles();
      });
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.setData({
      page: 1,
      articles: []
    }, () => {
      this.getArticles();
      wx.stopPullDownRefresh();
    });
  },

  // 跳转到添加文章页面
  navigateToAdd() {
    wx.navigateTo({
      url: '/pages/admin/article/add',
    });
  },

  // 跳转到编辑文章页面
  navigateToEdit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/article/edit?id=${id}`,
    });
  },

  // 删除文章
  deleteArticle(e) {
    const that = this;
    const id = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这篇文章吗？此操作不可撤销。',
      success(res) {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'deleteArticle',
            data: { id },
            success: res => {
              console.log('删除文章成功', res);
              if (res.result && res.result.success) {
                wx.showToast({
                  title: '删除成功',
                });
                // 重新加载文章列表
                that.setData({
                  page: 1,
                  articles: []
                }, () => {
                  that.getArticles();
                });
              } else {
                wx.showToast({
                  title: res.result.message || '删除失败',
                  icon: 'none'
                });
              }
            },
            fail: err => {
              console.error('删除文章失败', err);
              wx.showToast({
                title: '删除失败',
                icon: 'none'
              });
            }
          });
        }
      }
    });
  },

  // 预览文章
  previewArticle(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/article/detail?id=${id}`,
    });
  }
}) 