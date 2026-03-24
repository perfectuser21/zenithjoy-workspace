// pages/chatHistory/index.js
const app = getApp()
const db = wx.cloud.database()

Page({
  data: {
    isLoading: true,
    chatRecords: []
  },

  onLoad: function(options) {
    this.getChatHistory()
  },
  
  onShow: function() {
    // 可以在页面显示时重新加载数据
  },
  
  onPullDownRefresh: function() {
    this.getChatHistory(() => {
      wx.stopPullDownRefresh()
    })
  },
  
  // 获取聊天历史记录
  getChatHistory: function(callback) {
    this.setData({ isLoading: true })
    
    // 判断用户是否登录
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo) {
      this.setData({ 
        isLoading: false,
        chatRecords: []
      })
      if (callback) callback()
      return
    }
    
    // 从云数据库获取聊天记录
    db.collection('chats')
      .where({
        _openid: '{openid}' // 在云函数中会自动替换为当前用户openid
      })
      .orderBy('createTime', 'desc')
      .limit(50)
      .get()
      .then(res => {
        console.log('获取聊天记录成功', res)
        
        // 格式化数据
        const records = res.data.map(item => {
          // 格式化日期
          const date = new Date(item.createTime)
          const formatDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
          
          // 截取问题和回答（如果太长）
          const question = item.question ? (item.question.length > 50 ? item.question.substring(0, 50) + '...' : item.question) : '无问题内容'
          const answer = item.answer ? (item.answer.length > 100 ? item.answer.substring(0, 100) + '...' : item.answer) : ''
          
          return {
            ...item,
            formatDate,
            question,
            answer
          }
        })
        
        this.setData({
          chatRecords: records,
          isLoading: false
        })
      })
      .catch(err => {
        console.error('获取聊天记录失败', err)
        wx.showToast({
          title: '获取聊天记录失败',
          icon: 'none'
        })
        this.setData({ isLoading: false })
      })
      .finally(() => {
        if (callback) callback()
      })
  },
  
  // 导航到聊天详情
  navigateToChat: function(e) {
    const chatId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/ai-chat/ai-chat?id=${chatId}`
    })
  },
  
  // 导航到首页
  navigateToIndex: function() {
    wx.switchTab({
      url: '/pages/index/index'
    })
  }
}) 