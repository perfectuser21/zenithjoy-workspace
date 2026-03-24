// AI聊天页面
Page({
  data: {
    inputValue: '',
    messages: [],
    sending: false,
    lastConversationId: null,
    systemMessages: [],
    title: '',
    chatType: 'general',
    botId: ''
  },

  onLoad: function(options) {
    // 从url参数中获取标题和提示语
    const title = options.title ? decodeURIComponent(options.title) : 'AI助手';
    const prompt = options.prompt ? decodeURIComponent(options.prompt) : '';
    const type = options.type || 'general';
    const botId = options.botId || ''; // 添加botId参数
    
    wx.setNavigationBarTitle({
      title: title
    });
    
    this.setData({
      title: title,
      chatType: type,
      botId: botId // 保存botId到data中
    });
    
    const welcomeMessage = prompt || '你好！我是AI助手，有什么可以帮到您的吗？';
    
    // 初始化欢迎消息
    this.setData({
      messages: [
        {
          role: 'assistant',
          content: welcomeMessage,
          time: this.formatTime(new Date())
        }
      ]
    });
    
    // 自动滚动到底部
    this.scrollToBottom();
  },
  
  // 添加系统消息
  addSystemMessage: function(message, type = 'info') {
    const systemMessages = this.data.systemMessages;
    systemMessages.push({
      content: message,
      type: type,
      time: new Date().toLocaleTimeString()
    });
    
    // 最多保留5条系统消息
    if (systemMessages.length > 5) {
      systemMessages.shift();
    }
    
    this.setData({ systemMessages });
    
    // 5秒后自动清除
    setTimeout(() => {
      const updatedMessages = this.data.systemMessages.filter(msg => msg.content !== message);
      this.setData({ systemMessages: updatedMessages });
    }, 5000);
  },
  
  // 格式化时间 HH:MM
  formatTime: function(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  },
  
  // 处理文本框输入
  handleInputChange: function(e) {
    this.setData({
      inputValue: e.detail.value
    });
  },
  
  // 发送消息
  sendMessage: function() {
    const { inputValue, messages, botId } = this.data;
    
    // 检查输入是否为空
    if (!inputValue.trim()) {
      this.addSystemMessage('请输入有效内容', 'warning');
      return;
    }
    
    // 添加用户消息
    const updatedMessages = [...messages, {
      role: 'user',
      content: inputValue,
      time: this.formatTime(new Date())
    }];
    
    // 清空输入框并更新消息列表
    this.setData({
      messages: updatedMessages,
      inputValue: '',
      sending: true
    });
    
    // 自动滚动到底部
    this.scrollToBottom();
    
    // 添加加载中的消息占位
    const loadingMessage = {
      role: 'assistant',
      content: '思考中...',
      isLoading: true,
      time: this.formatTime(new Date())
    };
    
    this.setData({
      messages: [...updatedMessages, loadingMessage]
    });
    
    // 调用聊天API获取回复
    this.callChatAPI(inputValue, botId);
  },
  
  // 调用聊天API
  callChatAPI: function(message, botId) {
    // 调用云函数发送消息
    wx.cloud.callFunction({
      name: 'cozeAPIv2',
      data: {
        message: message,
        botId: botId,
        conversation_id: this.data.lastConversationId // 传递上一次的会话ID以保持上下文
      }
    }).then(res => {
      console.log('发送消息成功:', res);
      
      if (res.result && res.result.success) {
        // 保存会话ID
        if (res.result.conversation_id) {
          this.setData({
            lastConversationId: res.result.conversation_id
          });
        }
        
        // 获取最后一条消息，应该是loading状态的
        const { messages } = this.data;
        const lastIndex = messages.length - 1;
        const loadingMessage = messages[lastIndex];
        
        if (!loadingMessage || !loadingMessage.isLoading) return;
        
        // 用回复内容替换加载中的消息
        const updatedMessages = [...messages];
        updatedMessages[lastIndex] = {
          role: 'assistant',
          content: res.result.content || '抱歉，暂时无法回复您的问题',
          images: res.result.images || [],
          time: this.formatTime(new Date()),
          isLoading: false
        };
        
        this.setData({
          messages: updatedMessages,
          sending: false
        });
        
        // 自动滚动到底部
        this.scrollToBottom();
      } else {
        this.handleAPIError(res.result ? res.result.error : '发送消息失败');
      }
    }).catch(err => {
      console.error('调用云函数出错:', err);
      this.handleAPIError(err.message || '网络错误，请稍后重试');
    });
  },
  
  // 处理API错误
  handleAPIError: function(errorMsg) {
    console.error('API错误:', errorMsg);
    
    const { messages } = this.data;
    const lastIndex = messages.length - 1;
    const lastMessage = messages[lastIndex];
    
    // 检查最后一条消息是否是加载状态
    if (lastMessage && lastMessage.isLoading) {
      // 替换为错误消息
      const updatedMessages = [...messages];
      updatedMessages[lastIndex] = {
        role: 'assistant',
        content: `抱歉，发生了错误: ${errorMsg}`,
        time: this.formatTime(new Date()),
        isError: true,
        isLoading: false
      };
      
      this.setData({
        messages: updatedMessages,
        sending: false
      });
    } else {
      // 添加系统错误提示
      this.addSystemMessage(errorMsg, 'error');
      this.setData({ sending: false });
    }
  },
  
  // 滚动到底部
  scrollToBottom: function() {
    setTimeout(() => {
      wx.createSelectorQuery()
        .select('#message-container')
        .boundingClientRect(rect => {
          if (rect) {
            wx.pageScrollTo({
              scrollTop: rect.height,
              duration: 300
            });
          }
        })
        .exec();
    }, 100);
  },
  
  // 预览图片
  previewImage: function(e) {
    const { index, item } = e.currentTarget.dataset;
    const images = item.images;
    
    if (!images || images.length === 0) return;
    
    const urls = images.map(img => img.url || img.mpUrl);
    const current = urls[index];
    
    wx.previewImage({
      current,
      urls
    });
  }
}); 