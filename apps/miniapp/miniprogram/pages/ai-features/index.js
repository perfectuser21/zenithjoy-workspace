Page({
  data: {
    query: '',
    response: '',
    isLoading: false,
    history: [],
    scrollTop: 0,
    errorInfo: '',
    showSettings: false,
    apiKey: '',
    botId: '',
    apiConfigured: true,
    timeoutTimer: null,
    progressPercent: 0,
    estimatedTime: '预计需要40秒~2分钟',
    chatBots: [],
    selectedBot: null,
    switchBotModalVisible: false,
    useStreamMode: true,  // 默认使用流式响应
    streamingIndex: -1,   // 当前正在流式接收内容的消息索引，-1表示没有
    API_SETTINGS: {
      apiKey: '',
      botId: ''
    }
  },

  onLoad: function (options) {
    console.log('AI对话页面加载');
    // 从本地存储中读取历史记录
    var history = wx.getStorageSync('aiChatHistory') || [];
    
    // 读取API设置
    var apiKey = wx.getStorageSync('cozeApiKey') || '';
    var botId = wx.getStorageSync('cozeBotId') || '';
    
    // 如果没有保存API密钥，则自动保存新的API密钥
    if (!apiKey) {
      apiKey = 'pat_BSo4wqL0AH7Fii9IKE9ZGjyntLBdxdtB1UYt7o3MJIWfmYUj9uCAGqJ6zqCfSmDm';
      wx.setStorageSync('cozeApiKey', apiKey);
      wx.showToast({
        title: 'API密钥已自动配置',
        icon: 'success',
        duration: 2000
      });
    }
    
    this.setData({ 
      history: history,
      apiKey: apiKey,
      botId: botId
    });
    this.loadHistory();
    this.initApiSettings();
    this.initBots();
  },

  onShow: function() {
    console.log('AI对话页面显示');
  },

  inputQuery: function (e) {
    this.setData({
      query: e.detail.value
    });
  },

  inputApiKey: function (e) {
    this.setData({
      apiKey: e.detail.value
    });
  },
  
  inputBotId: function (e) {
    this.setData({
      botId: e.detail.value
    });
  },
  
  // 添加全局超时处理
  setupGlobalTimeout: function() {
    var that = this;
    // 清除已有的超时定时器
    if (this.data.timeoutTimer) {
      clearTimeout(this.data.timeoutTimer);
    }
    
    // 设置5分钟的全局超时（从3分钟增加到5分钟，适应更长的生成时间）
    var timeoutTimer = setTimeout(function() {
      if (that.data.isLoading) {
        console.log('全局超时，重置状态');
        that.setData({
          isLoading: false,
          errorInfo: '请求超时（超过5分钟），可能是网络问题或者服务器繁忙，请稍后重试。\n\n如果您询问的是复杂问题，可尝试拆分为多个简单问题。'
        });
        
        wx.showToast({
          title: '请求超时',
          icon: 'none',
          duration: 2000
        });
      }
    }, 300000); // 5分钟
    
    // 保存定时器ID
    this.setData({
      timeoutTimer: timeoutTimer
    });
  },
  
  toggleSettings: function() {
    this.setData({
      showSettings: !this.data.showSettings
    });
  },
  
  saveSettings: function() {
    // 保存API设置
    wx.setStorageSync('cozeApiKey', this.data.apiKey);
    wx.setStorageSync('cozeBotId', this.data.botId);
    
    this.setData({
      showSettings: false
    });
    
    wx.showToast({
      title: '设置已保存',
      icon: 'success'
    });
  },

  sendQuery: function() {
    const query = this.data.query;
    if (!query || query.trim() === '') {
      wx.showToast({
        title: '请输入问题',
        icon: 'none'
      });
      return;
    }
    
    // 根据模式选择发送方式
    if (this.data.useStreamMode) {
      // 使用流式响应
      this.sendStreamQuery(query);
    } else {
      // 使用轮询方式发送查询
      this.sendQueryWithPolling(query);
    }
  },
  
  // 使用流式响应发送查询
  sendStreamQuery: function(query) {
    console.log('使用流式响应发送查询:', query);
    
    // 设置加载状态
    this.setData({
      isLoading: true,
      lastQuery: query,
      progressPercent: 0,
      errorInfo: '正在处理您的请求...'
    });
    
    // 调用云函数获取流式API URL
    wx.cloud.callFunction({
      name: 'cozeAPIv2',
      data: {
        action: 'getStreamUrl',
        query: query,
        apiSettings: this.data.API_SETTINGS,
        useStream: true // 标记使用流式API
      },
      success: res => {
        console.log('获取流式API信息成功:', res);
        
        if (res.result && res.result.success) {
          const streamUrl = res.result.stream_url;
          const requestData = res.result.request_data;
          
          // 创建新历史记录
          var newRecord = {
            query: query,
            response: "AI思考中...",
            time: new Date().toLocaleString(),
            isStreaming: true
          };
          
          // 添加到历史记录的开头
          var history = [newRecord].concat(this.data.history);
          if (history.length > 20) {
            history.pop();
          }
          
          this.setData({
            history: history,
            streamingIndex: 0, // 标记当前正在流式接收的消息索引
            query: '' // 清空输入框
          });
          
          // 开始请求流式响应
          this.requestStreamResponse(streamUrl, requestData);
        } else {
          console.error('获取流式API信息失败:', res);
          this.setData({
            isLoading: false,
            errorInfo: res.result?.error || '连接服务失败'
          });
        }
      },
      fail: err => {
        console.error('调用云函数失败:', err);
        this.setData({
          isLoading: false,
          errorInfo: '网络错误: ' + err.errMsg
        });
      }
    });
  },
  
  // 请求流式响应并处理
  requestStreamResponse: function(url, requestData) {
    const that = this;
    
    // 使用wx.request发送POST请求获取流式响应
    // 由于微信小程序不支持原生EventSource，我们需要手动处理文本响应
    wx.request({
      url: url,
      method: 'POST',
      data: requestData,
      dataType: 'text', // 重要：使用text类型接收响应
      responseType: 'text',
      success: function(res) {
        if (res.statusCode === 200) {
          console.log('流式响应请求成功');
          that.processStreamResponse(res.data);
        } else {
          console.error('流式响应请求失败:', res);
          // 更新历史记录
          if (that.data.streamingIndex >= 0 && that.data.history.length > that.data.streamingIndex) {
            var history = that.data.history;
            history[that.data.streamingIndex].response = "获取回复失败，请重试。";
            history[that.data.streamingIndex].isStreaming = false;
            history[that.data.streamingIndex].error = true;
            
            that.setData({
              history: history,
              isLoading: false,
              streamingIndex: -1,
              errorInfo: `请求失败: ${res.statusCode}`
            });
          }
        }
      },
      fail: function(err) {
        console.error('流式响应请求错误:', err);
        // 更新历史记录
        if (that.data.streamingIndex >= 0 && that.data.history.length > that.data.streamingIndex) {
          var history = that.data.history;
          history[that.data.streamingIndex].response = "网络错误，无法获取回复。";
          history[that.data.streamingIndex].isStreaming = false;
          history[that.data.streamingIndex].error = true;
          
          that.setData({
            history: history,
            isLoading: false,
            streamingIndex: -1,
            errorInfo: `网络错误: ${err.errMsg}`
          });
        }
      }
    });
  },
  
  // 处理流式响应文本
  processStreamResponse: function(responseText) {
    console.log('处理流式响应');
    
    var messageId = null;
    var conversationId = null;
    var currentContent = "";
    
    // 解析SSE格式的响应
    const lines = responseText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('data:')) {
        const eventData = line.substring(5).trim();
        if (eventData === '[DONE]') {
          console.log('流已结束');
          continue;
        }
        
        try {
          const eventJson = JSON.parse(eventData);
          console.log('事件:', eventJson);
          
          // 处理不同类型的事件
          if (eventJson.event === 'start') {
            console.log('流开始');
          } 
          else if (eventJson.event === 'created') {
            // 消息已创建
            messageId = eventJson.message_id;
            conversationId = eventJson.conversation_id;
            console.log(`消息已创建: ID=${messageId}, 会话ID=${conversationId}`);
          } 
          else if (eventJson.event === 'chunk') {
            // 收到内容片段
            const chunk = eventJson.content;
            currentContent += chunk;
            
            // 更新历史记录中的当前流式消息
            if (this.data.streamingIndex >= 0 && this.data.history.length > this.data.streamingIndex) {
              var history = this.data.history;
              history[this.data.streamingIndex].response = currentContent;
              
              this.setData({
                history: history
              });
            }
          } 
          else if (eventJson.event === 'complete') {
            // 流完成
            const finalContent = eventJson.content || currentContent;
            messageId = eventJson.message_id || messageId;
            conversationId = eventJson.conversation_id || conversationId;
            
            console.log(`流完成，最终内容长度: ${finalContent.length}`);
            console.log(`消息ID: ${messageId}, 会话ID: ${conversationId}`);
            
            // 更新历史记录
            if (this.data.streamingIndex >= 0 && this.data.history.length > this.data.streamingIndex) {
              var history = this.data.history;
              history[this.data.streamingIndex].response = finalContent;
              history[this.data.streamingIndex].isStreaming = false;
              history[this.data.streamingIndex].messageId = messageId;
              history[this.data.streamingIndex].conversationId = conversationId;
              
              this.setData({
                history: history,
                isLoading: false,
                streamingIndex: -1,
                errorInfo: ''
              });
              
              // 保存到本地存储
              wx.setStorageSync('aiChatHistory', history);
            }
          }
          else if (eventJson.event === 'error') {
            // 错误事件
            console.error('流错误:', eventJson.message);
            
            // 更新历史记录
            if (this.data.streamingIndex >= 0 && this.data.history.length > this.data.streamingIndex) {
              var history = this.data.history;
              history[this.data.streamingIndex].response = `处理请求时出错: ${eventJson.message}`;
              history[this.data.streamingIndex].isStreaming = false;
              history[this.data.streamingIndex].error = true;
              
              this.setData({
                history: history,
                isLoading: false,
                streamingIndex: -1,
                errorInfo: `错误: ${eventJson.message}`
              });
            }
          }
        } catch (e) {
          console.error('解析事件数据失败:', e, eventData);
        }
      }
    }
  },
  
  // 使用轮询方式发送查询
  sendQueryWithPolling: function(query) {
    console.log('使用轮询方式发送查询:', query);
    
    const MAX_RETRIES = 120; // 最大轮询次数
    
    if (this.data.isLoading) {
      wx.showToast({
        title: '请等待当前请求完成',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      isLoading: true,
      lastQuery: query,
      progressPercent: 0,
      errorInfo: 'AI响应处理中...'
    });
    
    // 设置一个全局超时
    this.globalTimeout = setTimeout(() => {
      if (this.data.isLoading) {
        this.setData({
          isLoading: false,
          errorInfo: '请求超时，请重试'
        });
      }
    }, 300000); // 5分钟超时
    
    // 调用云函数创建消息
    wx.cloud.callFunction({
      name: 'cozeAPIv2',
      data: {
        query: query,
        apiSettings: this.data.API_SETTINGS
      },
      success: res => {
        console.log('创建消息成功:', res);
        
        if (res.result && res.result.success) {
          const messageId = res.result.message_id;
          const conversationId = res.result.conversation_id;
          
          console.log(`开始轮询状态: 消息ID=${messageId}, 会话ID=${conversationId}`);
          
          // 开始轮询消息状态
          this.pollMessageStatus(messageId, conversationId, this.data.API_SETTINGS, query, MAX_RETRIES);
        } else {
          console.error('创建消息失败:', res);
          this.clearGlobalTimeout();
          this.setData({
            isLoading: false,
            errorInfo: res.result?.error?.message || '创建消息失败，请重试'
          });
        }
      },
      fail: err => {
        console.error('调用云函数失败:', err);
        this.clearGlobalTimeout();
        this.setData({
          isLoading: false,
          errorInfo: '网络错误: ' + err.errMsg
        });
      }
    });
  },
  
  // 轮询消息状态
  pollMessageStatus: function(messageId, conversationId, apiSettings, query, maxRetries, attempt = 1, startTime = Date.now()) {
    console.log(`开始轮询消息状态 (第${attempt}次尝试): `, messageId);
    console.log('轮询会话ID: ', conversationId);
    
    if (!messageId) {
      console.error('无法轮询消息状态：缺少消息ID');
      return;
    }
    
    // 如果超过最大重试次数，则停止轮询并将状态设为强制完成
    if (attempt > maxRetries) {
      console.warn(`超过最大重试次数 (${maxRetries})，强制完成消息`);
      
      // 最后一次尝试将forceCompleted设为true
      wx.cloud.callFunction({
        name: 'cozeAPIv2',
        data: {
          action: 'forceComplete',
          messageId: messageId,
          conversationId: conversationId,
          apiSettings: apiSettings,
          forceCompleted: true
        }
      }).then(res => {
        console.log('强制完成消息状态查询结果: ', res);
        
        // 处理强制完成的结果
        if (res && res.result) {
          this.handleStatusResponse(res.result, messageId, conversationId, apiSettings, query, maxRetries, attempt, startTime);
        } else {
          console.error('强制完成消息状态查询失败: ', res);
          this.setData({
            isLoading: false
          });
          
          // 添加默认回复到历史记录
          this.addAIResponseToHistory(query, '您的请求处理时间过长，系统已自动结束。请尝试简化您的问题或稍后再试。', true);
        }
      }).catch(err => {
        console.error('强制完成消息状态查询出错: ', err);
        this.setData({
          isLoading: false
        });
        
        // 添加错误回复到历史记录
        this.addAIResponseToHistory(query, '查询消息状态时发生错误，请稍后再试。', true);
      });
      
      return;
    }
    
    // 计算轮询进度百分比
    const progressPercentage = Math.min(90, Math.round((attempt / maxRetries) * 100));
    
    // 估算剩余时间（秒）
    let elapsedTime = (Date.now() - startTime) / 1000;
    let estimatedTotal = (elapsedTime / progressPercentage) * 100;
    let remainingTime = Math.max(0, Math.round(estimatedTotal - elapsedTime));
    
    // 设置进度和估计时间
    this.setData({
      progressPercent: progressPercentage,
      errorInfo: `AI响应处理中 (${progressPercentage}%)...\n预计剩余: ${remainingTime}秒`
    });
    
    // 在控制台显示进度信息
    console.log(`轮询进度: ${progressPercentage}%, 已用时间: ${Math.round(elapsedTime)}秒, 预计剩余: ${remainingTime}秒`);
    
    // 基于尝试次数动态调整轮询间隔
    let intervalMs;
    if (attempt <= 10) {
      intervalMs = 3000; // 前10次，每3秒
    } else if (attempt <= 30) {
      intervalMs = 4000; // 11-30次，每4秒
    } else if (attempt <= 60) {
      intervalMs = 5000; // 31-60次，每5秒
    } else {
      intervalMs = 6000; // 60次以上，每6秒
    }
    
    // 调用云函数检查消息状态
    setTimeout(() => {
      wx.cloud.callFunction({
        name: 'cozeAPIv2',
        data: {
          action: 'checkStatus',
          messageId: messageId,
          conversationId: conversationId,
          apiSettings: apiSettings,
          forceCompleted: false // 非强制完成
        }
      }).then(res => {
        if (res && res.result) {
          this.handleStatusResponse(res.result, messageId, conversationId, apiSettings, query, maxRetries, attempt, startTime);
        } else {
          console.error('消息状态查询失败: ', res);
          // 继续轮询
          this.pollMessageStatus(messageId, conversationId, apiSettings, query, maxRetries, attempt + 1, startTime);
        }
      }).catch(err => {
        console.error('查询消息状态出错: ', err);
        // 继续轮询
        this.pollMessageStatus(messageId, conversationId, apiSettings, query, maxRetries, attempt + 1, startTime);
      });
    }, intervalMs);
  },
  
  // 处理状态响应
  handleStatusResponse: function(result, messageId, conversationId, apiSettings, query, maxRetries, attempt, startTime) {
    console.log(`消息状态查询结果 (第${attempt}次尝试): `, result);
    
    // 尝试从多个可能的字段获取状态
    const status = result.status || 
                  (result.data && result.data.status) || 
                  '';
    
    // 检查消息是否已完成
    const isCompleted = result.completed === true || 
                        status === 'completed' || 
                        status === 'replied' ||
                        result.force_completed === true;
    
    // 记录消息状态
    console.log(`消息状态: ${status}, 已完成: ${isCompleted}, 强制完成: ${result.force_completed === true}, 尝试次数: ${attempt}`);
    
    if (isCompleted) {
      // 消息已完成处理
      console.log('AI回复已完成');
      
      // 尝试获取回复内容
      let response = result.response || 
                    (result.data && result.data.response) || 
                    result.reply || 
                    (result.data && result.data.reply) || 
                    '';
      
      // 检查是否有输出但未获取到内容
      const hasOutput = result.has_output === true;
      
      // 如果没有回复内容但消息已完成
      if (!response || response.trim() === '') {
        if (hasOutput) {
          console.log('消息已完成但未获取到回复内容，使用已生成输出的默认回复');
          response = "您的请求已处理完成，AI已生成回复内容，但系统未能成功获取。请检查Coze界面或尝试重新发送您的问题。";
        } else {
          console.log('消息已完成但无回复内容，使用默认回复');
          response = "您的请求已处理完成，但未收到回复内容。请尝试重新发送您的问题，或者改变提问方式。";
        }
      }
      
      // 添加到历史记录
      this.addAIResponseToHistory(query, response, result.fallback === true);
      
      // 更新UI状态
      this.setData({
        isLoading: false,
        errorInfo: ''
      });
      
      // 清除全局超时
      this.clearGlobalTimeout();
    } else {
      // 消息仍在处理中，继续轮询
      console.log(`消息仍在处理中 (${status}), 继续轮询...`);
      this.pollMessageStatus(messageId, conversationId, apiSettings, query, maxRetries, attempt + 1, startTime);
    }
  },
  
  // 添加AI响应到历史记录
  addAIResponseToHistory: function(query, response, isFallback = false) {
    // 创建新记录
    var newRecord = {
      query: query,
      response: response,
      time: new Date().toLocaleString(),
      isFallback: isFallback
    };
    
    // 添加到历史记录
    var history = [newRecord].concat(this.data.history);
    if (history.length > 20) {
      history.pop();
    }
    
    // 更新UI
    this.setData({
      history: history,
      query: '',  // 清空输入框
      scrollTop: 0  // 滚动到顶部
    });
    
    // 保存到本地存储
    wx.setStorageSync('aiChatHistory', history);
    
    // 显示成功提示
    wx.showToast({
      title: 'AI回复已生成',
      icon: 'success',
      duration: 1500
    });
  },
  
  // 清除全局超时
  clearGlobalTimeout: function() {
    if (this.globalTimeout) {
      clearTimeout(this.globalTimeout);
      this.globalTimeout = null;
    }
  },
  
  // 打开API设置面板
  openApiSettings: function() {
    wx.navigateTo({
      url: '../settings/index'
    });
  },
  
  // 打开切换机器人模态框
  openSwitchBotModal: function() {
    this.setData({
      switchBotModalVisible: true
    });
  },
  
  // 关闭切换机器人模态框
  closeSwitchBotModal: function() {
    this.setData({
      switchBotModalVisible: false
    });
  },
  
  // 选择机器人
  selectBot: function(e) {
    const index = e.currentTarget.dataset.index;
    const bot = this.data.chatBots[index];
    
    this.setData({
      selectedBot: bot,
      switchBotModalVisible: false,
      API_SETTINGS: {
        apiKey: bot.apiKey,
        botId: bot.botId
      }
    });
    
    // 保存API设置
    wx.setStorageSync('apiSettings', this.data.API_SETTINGS);
    
    wx.showToast({
      title: `已切换到 ${bot.name}`,
      icon: 'success'
    });
  },
  
  // 清空历史记录
  clearHistory: function() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有历史记录吗？此操作不可撤销。',
      success: res => {
        if (res.confirm) {
          this.setData({
            history: []
          });
          wx.setStorageSync('aiChatHistory', []);
          
          wx.showToast({
            title: '历史已清空',
            icon: 'success'
          });
        }
      }
    });
  },

  copyResponse: function (e) {
    var index = e.currentTarget.dataset.index;
    var text = this.data.history[index].response;
    
    wx.setClipboardData({
      data: text,
      success: function () {
        wx.showToast({
          title: '已复制',
          icon: 'success'
        });
      }
    });
  },
  
  // 复制错误信息
  copyError: function () {
    if (!this.data.errorInfo) {
      return;
    }
    
    wx.setClipboardData({
      data: this.data.errorInfo,
      success: function () {
        wx.showToast({
          title: '错误信息已复制',
          icon: 'success'
        });
      }
    });
  },

  handleError: function (message) {
    this.setData({
      isLoading: false
    });
    wx.showToast({
      title: message,
      icon: 'none',
      duration: 3000 // 显示3秒
    });
  },

  // 初始化API设置
  initApiSettings: function() {
    try {
      // 尝试从本地存储读取API设置
      const apiSettings = wx.getStorageSync('apiSettings');
      if (apiSettings) {
        this.setData({
          API_SETTINGS: apiSettings
        });
        console.log('已加载API设置:', apiSettings);
      }
    } catch (e) {
      console.error('读取API设置失败:', e);
    }
  },
  
  // 初始化聊天机器人
  initBots: function() {
    try {
      // 尝试从本地存储读取机器人列表
      const bots = wx.getStorageSync('chatBots');
      if (bots && bots.length) {
        this.setData({
          chatBots: bots,
          selectedBot: bots[0]
        });
        console.log('已加载机器人列表:', bots);
      }
    } catch (e) {
      console.error('读取机器人列表失败:', e);
    }
  },
  
  // 加载历史记录
  loadHistory: function() {
    try {
      const history = wx.getStorageSync('aiChatHistory');
      if (history) {
        this.setData({
          history: history
        });
        console.log('已加载历史记录, 条数:', history.length);
      }
    } catch (e) {
      console.error('读取历史记录失败:', e);
    }
  },
  
  // 切换流式响应模式
  toggleStreamMode: function() {
    this.setData({
      useStreamMode: !this.data.useStreamMode
    });
    wx.showToast({
      title: this.data.useStreamMode ? '已开启流式响应' : '已关闭流式响应',
      icon: 'none'
    });
  },
}); 