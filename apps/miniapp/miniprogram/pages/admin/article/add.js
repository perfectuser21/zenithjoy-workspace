// pages/admin/article/add.js
Page({
  data: {
    title: '',
    desc: '',
    content: '',
    cover: '/images/default-cover.png',
    tags: ['AI资讯'],
    author: '',
    submitting: false,
    coverPreview: '/images/default-cover.png'
  },

  onLoad: function(options) {
    // 获取用户个人信息作为默认作者
    this.getDefaultAuthor();
  },

  // 获取默认作者
  getDefaultAuthor() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({
        author: userInfo.nickName || '管理员'
      });
    }
  },

  // 监听标题输入
  onTitleInput(e) {
    this.setData({
      title: e.detail.value
    });
  },

  // 监听摘要输入
  onDescInput(e) {
    this.setData({
      desc: e.detail.value
    });
  },

  // 监听内容输入
  onContentInput(e) {
    this.setData({
      content: e.detail.value
    });
  },

  // 监听作者输入
  onAuthorInput(e) {
    this.setData({
      author: e.detail.value
    });
  },

  // 选择封面图
  chooseCover() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFilePaths[0];
        
        // 先预览所选图片
        this.setData({
          coverPreview: tempFilePath
        });
        
        // 上传图片到云存储
        this.uploadCoverImage(tempFilePath);
      }
    });
  },

  // 上传封面图到云存储
  uploadCoverImage(filePath) {
    wx.showLoading({
      title: '正在上传...',
    });
    
    const cloudPath = `covers/${Date.now()}-${Math.floor(Math.random() * 1000)}${filePath.match(/\.[^.]+?$/)[0]}`;
    
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: res => {
        console.log('上传封面成功', res);
        // 获取图片的云端路径
        const fileID = res.fileID;
        
        this.setData({
          cover: fileID
        });
        
        wx.hideLoading();
        wx.showToast({
          title: '上传成功',
        });
      },
      fail: err => {
        console.error('上传封面失败', err);
        wx.hideLoading();
        wx.showToast({
          title: '上传失败',
          icon: 'none'
        });
      }
    });
  },

  // 添加标签
  addTag() {
    wx.showModal({
      title: '添加标签',
      editable: true,
      placeholderText: '请输入标签名称',
      success: res => {
        if (res.confirm && res.content) {
          const tags = [...this.data.tags];
          // 检查是否已存在相同标签
          if (!tags.includes(res.content)) {
            tags.push(res.content);
            this.setData({ tags });
          } else {
            wx.showToast({
              title: '标签已存在',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  // 删除标签
  removeTag(e) {
    const index = e.currentTarget.dataset.index;
    const tags = [...this.data.tags];
    tags.splice(index, 1);
    this.setData({ tags });
  },

  // 验证表单
  validateForm() {
    if (!this.data.title.trim()) {
      wx.showToast({
        title: '请输入文章标题',
        icon: 'none'
      });
      return false;
    }
    
    if (!this.data.content.trim()) {
      wx.showToast({
        title: '请输入文章内容',
        icon: 'none'
      });
      return false;
    }
    
    return true;
  },

  // 提交表单
  submitForm() {
    if (!this.validateForm()) return;
    
    this.setData({ submitting: true });
    
    // 准备提交的数据
    const articleData = {
      title: this.data.title,
      desc: this.data.desc || this.data.content.substring(0, 100),
      content: this.data.content,
      cover: this.data.cover,
      tags: this.data.tags,
      author: this.data.author || '管理员'
    };
    
    // 调用云函数创建文章
    wx.cloud.callFunction({
      name: 'createArticle',
      data: articleData,
      success: res => {
        console.log('创建文章成功', res);
        if (res.result && res.result.success) {
          wx.showToast({
            title: '发布成功',
          });
          
          // 延迟返回上一页
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        } else {
          this.setData({ submitting: false });
          wx.showToast({
            title: res.result.message || '发布失败',
            icon: 'none'
          });
        }
      },
      fail: err => {
        console.error('创建文章失败', err);
        this.setData({ submitting: false });
        wx.showToast({
          title: '发布失败',
          icon: 'none'
        });
      }
    });
  },

  // 预览效果
  previewArticle() {
    if (!this.validateForm()) return;
    
    // 创建临时文章
    const previewArticle = {
      title: this.data.title,
      desc: this.data.desc || this.data.content.substring(0, 100),
      content: this.data.content,
      cover: this.data.coverPreview,
      tags: this.data.tags,
      author: this.data.author || '管理员',
      date: this.formatDate(new Date()),
      views: 0,
      likes: 0
    };
    
    // 将预览数据存储到本地
    wx.setStorage({
      key: 'previewArticle',
      data: previewArticle,
      success: () => {
        // 跳转到预览页面
        wx.navigateTo({
          url: '/pages/article/preview',
        });
      }
    });
  },

  // 格式化日期为 YYYY-MM-DD 格式
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}) 