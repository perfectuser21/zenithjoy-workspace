// 云函数入口文件 - cozeAPIv2
const cloud = require('wx-server-sdk');
const axios = require('axios');
const crypto = require('crypto');

// 尝试初始化云开发环境
try {
  cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
  });
  console.log('云开发环境初始化成功');
} catch (initError) {
  console.error('云开发环境初始化失败:', initError);
  console.log('继续执行，但数据库操作可能会失败');
}

// 获取数据库引用，包装在try-catch中
let db;
try {
  db = cloud.database();
  console.log('成功获取数据库引用');
} catch (dbError) {
  console.error('获取数据库引用失败:', dbError);
  console.log('数据库操作将被跳过');
  // 创建一个模拟的db对象，防止代码中的db调用失败
  db = {
    collection: () => ({
      doc: () => ({
        update: async () => ({ errMsg: 'db模拟：更新被跳过' }),
        get: async () => ({ data: {} })
      }),
      add: async () => ({ _id: 'mock_id', errMsg: 'db模拟：添加被跳过' })
    }),
    serverDate: () => new Date()
  };
}

// Coze API 配置
const COZE_API_BASE_URL = 'https://api.coze.com';
const COZE_API_KEY = 'your_coze_api_key'; // 请替换为实际的 API Key
const BOT_ID = '7481212266399449139'; // 默认使用agent1的ID

// 记录环境信息，用于调试
function logEnvironmentInfo() {
  console.log('云函数环境信息:');
  try {
    console.log('当前环境:', cloud.DYNAMIC_CURRENT_ENV);
    console.log('NAMESPACE:', process.env.SCF_NAMESPACE || '未知');
    return true;
  } catch (error) {
    console.error('获取环境信息失败:', error);
    return false;
  }
}

// 轮询获取消息状态
async function pollForMessageResponse(conversationId, chatId, options = {}) {
  console.log(`开始轮询消息状态，消息ID: ${chatId}, 会话ID: ${conversationId}`);
  
  // 在函数内部定义isMiniProgram变量，避免依赖外部传递
  const isMiniProgram = true; // 默认假设为小程序环境
  
  let attempt = 0;
  const { retries = 0, cleanMd = false, originalQuery } = options;
  let content = '';
  const maxAttempts = 60; // 最多尝试60次
  const delay = 10000; // 每10秒查询一次
    
  // 完整的轮询逻辑，使用正确的v3版本API端点进行轮询
  // 轮询直到得到结果或超时
  while (attempt < maxAttempts) {
    attempt++;
    console.log(`轮询尝试 ${attempt}/${maxAttempts}`);
    
    // 等待一段时间
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      // 使用正确的API端点进行轮询（根据官方文档）
      const retrieveUrl = `https://api.coze.cn/v3/chat/message/list`;
      
      // 准备请求参数，获取更多历史消息
      const queryParams = {
        conversation_id: conversationId,
        chat_id: chatId,
        limit: 20, // 获取更多的历史消息
        include_histories: true // 请求包含历史消息
      };
      
      console.log(`调试 - 使用官方正确的API端点: ${retrieveUrl}, 参数:`, JSON.stringify(queryParams));
      
      // 发送查询请求
      const pollResponse = await axios({
        method: 'get',
        url: retrieveUrl,
        headers: {
          'Authorization': `Bearer ${COZE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        params: queryParams,
        timeout: 10000 // 10秒超时
      });
      
      // 检查响应状态
      if (!pollResponse || pollResponse.status !== 200) {
        throw new Error(`API查询失败，状态码: ${pollResponse ? pollResponse.status : '未知'}`);
      }
      
      // 处理响应数据
      const pollResult = pollResponse.data;
      console.log('API响应数据:', JSON.stringify(pollResult).substring(0, 200) + '...');
      
      // 检查API是否返回错误
      if (pollResult.code !== 0) {
        throw new Error(`API返回错误: ${pollResult.msg || '未知错误'}, 错误代码: ${pollResult.code}`);
      }
      
      // 正确解析消息列表
      if (!pollResult.data || !Array.isArray(pollResult.data) || pollResult.data.length === 0) {
        console.log('API返回的消息列表为空');
        throw new Error('API返回的消息列表为空');
      }
      
      // 查找是否有AI的回复消息
      const messages = pollResult.data;
      console.log(`收到${messages.length}条消息`);
      
      // 存储找到的图片链接
      let imageLinks = [];
      
      // 存储AI的回复消息
      let aiReplyMessage = null;
      
      // 检查每条消息，寻找AI的回复
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        
        console.log(`消息${i + 1} - role: ${msg.role || '未知'}, chat_id: ${msg.chat_id}, created_at: ${msg.created_at || '未知'}`);
        
        if (msg.content && typeof msg.content === 'string') {
          // 输出内容的前100个字符
          console.log(`消息${i + 1}内容前100个字符: ${msg.content.substring(0, 100)}...`);
          
          // 更严格地区分用户消息和AI回复
          if (msg.role === 'assistant' && 
              msg.content.length > 10 && 
              !msg.content.includes('plugin_id') &&
              !msg.content.includes('AI_R1_XX021925_v1 directly streaming reply') &&
              !msg.content.includes('msg_type') &&
              !msg.content.includes('generate_answer_finish') &&
              !msg.content.includes('from_module') && 
              !msg.content.includes('from_unit') &&
              !msg.content.includes('interrupt')) {
              
            // 检查消息是否与原始查询完全匹配，如果是则跳过
            if (options.originalQuery && msg.content.trim() === options.originalQuery.trim()) {
              console.log(`消息${i + 1}与用户原始查询相同，跳过`);
              continue;
            }
            
            console.log(`找到疑似AI回复: ${msg.content.substring(0, 50)}...`);
            
            // 记录更多信息以便分析
            console.log(`AI回复消息完整角色: ${msg.role}, 长度: ${msg.content.length}`);
            
            // 判断内容是否有实质性内容（不仅仅是重复用户的问题）
            if (aiReplyMessage === null || msg.content.length > aiReplyMessage.content.length) {
              aiReplyMessage = msg;
              console.log(`更新当前最佳AI回复为消息${i + 1}`);
            }
          } else if (msg.role === 'user') {
            console.log(`消息${i + 1}是用户消息，跳过`);
          } else {
            console.log(`消息${i + 1}不符合AI回复标准，跳过`);
          }
          
          // 检查是否包含图片标记
          if (msg.content.includes('![image]') || 
              msg.content.includes('![图片]') || 
              msg.content.includes('https://s.coze.cn/')) {
            
            console.log(`发现图片消息: ${msg.content}`);
            
            // 直接内联图片URL提取代码
            if (msg.content && typeof msg.content === 'string') {
              // 尝试提取URL
              const matches = msg.content.match(/https:\/\/s\.coze\.cn\/t\/[^)\s]+/g);
              if (matches) {
                matches.forEach(url => {
                  // 清理URL - 去除末尾的多余字符如 ) / 等
                  let cleanUrl = url.replace(/[\/\)]+$/, '');
                  
                  // 确保URL末尾没有斜杠
                  if (cleanUrl.endsWith('/')) {
                    cleanUrl = cleanUrl.substring(0, cleanUrl.length - 1);
                  }
                  
                  console.log(`提取图片URL: ${cleanUrl}`);
                  
                  // 去重添加
                  if (!imageLinks.includes(cleanUrl)) {
                    imageLinks.push(cleanUrl);
                  }
                });
              }
            }
          }
        }
      }
      
      // 确保找到了AI回复
      if (aiReplyMessage) {
        console.log(`找到完整AI回复(长度>${aiReplyMessage.content.length}): ${aiReplyMessage.content.substring(0, 50)}...`);
        
        let realContent = aiReplyMessage.content;
        let cleanedContent = realContent;
        
        // 清理Markdown格式
        try {
          if (options.cleanMd !== false) {
            // 清理Markdown标记
            // 替换标题标记
            cleanedContent = cleanedContent.replace(/^#+\s+(.*)$/gm, '$1');
            
            // 替换粗体和斜体
            cleanedContent = cleanedContent.replace(/\*\*\*([^*]+)\*\*\*/g, '$1'); // 先处理三星号
            cleanedContent = cleanedContent.replace(/\*\*([^*]+)\*\*/g, '$1');
            cleanedContent = cleanedContent.replace(/\*([^*]+)\*/g, '$1');
            
            // 替换列表标记
            cleanedContent = cleanedContent.replace(/^\s*[-*]\s+/gm, '• ');
            cleanedContent = cleanedContent.replace(/^\s*\d+\.\s+/gm, '• ');
            
            // 移除代码块标记
            cleanedContent = cleanedContent.replace(/```[a-z]*\n/g, '');
            cleanedContent = cleanedContent.replace(/```\n/g, '');
            
            // 替换链接
            cleanedContent = cleanedContent.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
            
            // 保留图片链接，但格式更友好
            cleanedContent = cleanedContent.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, '[图片]');
            
            // 移除多余空行
            cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');
          }
          
          console.log('Markdown清理完成，清理前长度:', realContent.length, '清理后长度:', cleanedContent.length);
        } catch (e) {
          console.error('清理Markdown失败:', e);
          // 出错时继续使用原始内容
        }
        
        // 确保realContent存在且是字符串
        if (typeof realContent !== 'string') {
          console.log('警告：realContent不是字符串，尝试转换');
          realContent = String(realContent || '');
        }
        
        // 尝试更新数据库记录状态，但只在chatId有效时
        if (chatId) {
          const updateResult = await db.collection('messages').doc(chatId).update({
            data: {
              status: 'completed',
              completed_at: db.serverDate(),
              content: cleanedContent,
              images: imageLinks
            }
          });
          console.log('数据库更新成功：', updateResult);
        } else {
          console.log('chatId为空，跳过数据库更新');
        }
        
        // 无论数据库更新是否成功，都返回找到的内容
        return {
          success: true,
          data: {
            status: 'completed',
            content: cleanedContent,
            raw_content: realContent, // 保留原始内容
            images: imageLinks, // 返回图片对象数组
            // 添加渲染指南
            rendering_guide: {
              image_count: imageLinks.length,
              has_images: imageLinks.length > 0,
              recommendation: "建议以图片墙的形式显示图片，每行显示3张图片",
              image_formats: ["jpg", "jpeg", "png"]
            }
          }
        };
      }
      
      // 如果仍然没有找到完整内容，但轮询次数还不多，继续轮询
      if (attempt < maxAttempts / 2) {
        console.log(`尚未找到完整回复，继续轮询 (${attempt}/${maxAttempts})`);
        continue;
      }
      
      // 如果已经轮询很多次，但仍未找到内容，考虑返回最新消息的内容作为临时结果
      if (messages.length > 0 && messages[0].content) {
        const tempContent = messages[0].content;
        console.log('轮询次数较多，未找到完整回复，返回最新消息作为临时结果:', tempContent.substring(0, 50) + '...');
        
        // 检查是否有任何响应表明需要更多输入
        const needsMoreInput = messages.some(msg => {
          return msg.content && 
                 typeof msg.content === 'string' && 
                 (msg.content.includes('需要您提供更多信息') || 
                  msg.content.includes('请提供具体的') ||
                  msg.content.includes('您想了解什么内容'));
        });
        
        if (needsMoreInput) {
          const promptMsg = messages.find(msg => {
            return msg.content && 
                   typeof msg.content === 'string' && 
                   (msg.content.includes('需要您提供更多信息') || 
                    msg.content.includes('请提供具体的') ||
                    msg.content.includes('您想了解什么内容'));
          });
          
          if (promptMsg) {
            realContent = promptMsg.content;
            console.log('AI需要更多输入，返回提示消息:', realContent);
            
            // 更新数据库记录状态
            try {
              const updateResult = await db.collection('messages').doc(chatId).update({
                data: {
                  status: 'needs_input',
                  completed_at: db.serverDate(),
                  content: realContent
                }
              });
              console.log('数据库更新成功(需要更多输入)：', updateResult);
            } catch (dbError) {
              // 数据库更新失败，但不中断流程
              console.error('更新数据库失败:', dbError);
              console.log('数据库更新失败，但仍将返回提示消息');
            }
            
            // 返回提示消息，无论数据库更新是否成功
            return {
              success: true,
              data: {
                status: 'needs_input',
                content: realContent
              }
            };
          }
        }

        // 修改返回部分完成内容的代码
        try {
          const updateResult = await db.collection('messages').doc(chatId).update({
            data: {
              status: 'partial_completed',
              completed_at: db.serverDate(),
              content: tempContent
            }
          });
          console.log('数据库更新成功(部分完成)：', updateResult);
        } catch (dbError) {
          // 数据库更新失败，但不中断流程
          console.error('更新数据库失败:', dbError);
          console.log('数据库更新失败，但仍将返回部分完成内容');
        }

        // 返回临时内容，无论数据库更新是否成功
        return {
          success: true,
          data: {
            status: 'partial_completed',
            content: `⏳ 内容正在生成中，请稍后再尝试查看完整内容: ${tempContent.substring(0, 100)}...`
          }
        };
      }
      
      // 如果超过了一定次数还没有结果，可能是API有问题
      if (attempt >= maxAttempts / 2) {
        console.log(`已轮询${attempt}次，仍未找到内容，可能需要检查API或增加轮询次数`);
      }
      
    } catch (error) {
      console.error(`轮询失败 (${attempt}/${maxAttempts}):`, error.message);
      
      // 如果是最后一次尝试，则抛出错误
      if (attempt >= maxAttempts) {
        throw new Error(`轮询消息状态失败: ${error.message}`);
      }
    }
  }
  
  // 如果所有尝试都失败，则抛出超时错误
  throw new Error(`轮询超时，${maxAttempts}次尝试后仍未获取到完成的消息`);
}

// 添加callAI函数实现
// 封装调用Coze API的函数
async function callAI(query, openId, messageId, existingConversationId, options = {}) {
  try {
    console.log('callAI函数调用参数:', JSON.stringify({
      query, 
      openId, 
      messageId, 
      existingConversationId, 
      options
    }));
    
    // 解析botId (可以从options中传入，或从event直接传入)
    const botId = options.botId || options.bot_id || BOT_ID; // 使用传入的botId或默认值
    console.log(`开始调用AI, botId: ${botId}, query: ${query}`);
    
    // 获取conversations集合引用
    let conversations;
    try {
      conversations = db.collection('conversations');
    } catch (error) {
      console.error('获取会话集合引用失败:', error);
      // 模拟一个空对象，让后续代码不出错
      conversations = {
        doc: () => ({
          update: async () => ({ errMsg: 'db模拟：更新被跳过' })
        })
      };
    }
    
    // 准备请求数据
    const requestData = {
      bot_id: botId,
      user_id: openId,
      stream: false,
      auto_save_history: true,
      additional_messages: [
        {
          role: "user",
          content: query,
          content_type: "text"
        }
      ]
    };
    
    // 如果有会话ID，添加到请求中
    if (existingConversationId) {
      requestData.conversation_id = existingConversationId;
    }
    
    // 添加额外选项
    if (options) {
      // 图片选项
      if (options.include_images === true || options.include_images === false) {
        requestData.include_images = options.include_images;
      }
      
      // 保存其他可能需要传递的选项
      requestData.additional_options = options;
    }
    
    console.log('Coze API请求数据:', JSON.stringify(requestData));
    
    // 更新数据库状态为"processing"，但仅在messageId有效时
    if (messageId) {
      try {
        await conversations.doc(messageId).update({
          data: {
            status: 'processing',
            processing_at: new Date()
          }
        });
      } catch (dbError) {
        console.error('更新处理状态失败:', dbError);
        // 继续执行，不中断流程
      }
    } else {
      console.log('messageId为空，跳过数据库更新操作');
    }
    
    console.log('开始调用Coze API...');
    console.log(`使用API密钥的前10个字符: ${COZE_API_KEY.substring(0, 10)}...`);
    
    // 调用Coze API
    const response = await axios({
      method: 'post',
      url: `${COZE_API_BASE_URL}/v1/bot/${botId}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COZE_API_KEY}`
      },
      data: requestData,
      timeout: 30000 // 30秒超时，仅用于初始请求
    });
    
    if (!response || !response.data) {
      throw new Error('API返回空响应');
    }
    
    console.log('API响应状态码:', response.status);
    console.log('API初始响应:', JSON.stringify(response.data).substring(0, 200) + '...');

    // 检查API响应是否包含错误码
    if (response.data.code !== 0) {
      // 获取API返回的错误信息
      const errorCode = response.data.code;
      const errorMsg = response.data.msg || '未知错误';
      console.log(`Coze API返回错误: 代码=${errorCode}, 消息=${errorMsg}`);
      
      throw new Error(`Coze API错误(${errorCode}): ${errorMsg}`);
    }

    // 从响应中提取会话ID和消息ID
    const result = response.data;
    if (!result.data || !result.data.id) {
      throw new Error('API响应格式无效: 缺少必要的id字段');
    }
    
    const chatId = result.data.id;
    const conversationId = result.data.conversation_id || existingConversationId;
    
    // 更新会话ID，但仅在messageId存在时
    if (messageId) {
      try {
        await conversations.doc(messageId).update({
          data: {
            conversation_id: conversationId
          }
        });
        console.log('成功更新会话ID');
      } catch (dbError) {
        console.error('更新会话ID失败:', dbError);
        // 继续执行，不中断流程
      }
    } else {
      console.log('messageId为空，跳过更新会话ID操作');
    }
    
    // 轮询等待消息处理完成
    console.log(`开始轮询消息状态，消息ID: ${chatId}, 会话ID: ${conversationId}`);
    console.log(`当前请求: query=${query}, openId=${openId.substring(0, 8)}...`);
    
    // 检查请求中是否指定了格式选项
    let cleanMarkdown = true; // 默认启用清理
    if (options.clean_markdown === false) { // 只有明确设置为false时才禁用
      cleanMarkdown = false;
      console.log('用户请求保留Markdown格式');
    }

    // 调用轮询函数
    const pollResult = await pollForMessageResponse(conversationId, chatId, {
      cleanMd: cleanMarkdown,
      originalQuery: query // 传入原始查询用于调试
    });
    
    if (pollResult.success) {
      // 更新数据库，但仅在messageId有效时
      if (messageId) {
        try {
          await conversations.doc(messageId).update({
            data: {
              status: pollResult.data.status,
              content: pollResult.data.content,
              completed_at: new Date()
            }
          });
          console.log('成功更新会话状态');
        } catch (dbError) {
          // 数据库更新失败，但不中断流程
          console.error('更新会话数据库失败:', dbError);
          console.log('数据库更新失败，但仍将返回AI回复内容');
        }
      } else {
        console.log('messageId为空，跳过更新会话状态操作');
      }
      
      // 确保返回包含实际内容
      console.log(`成功获取AI回复，内容长度: ${pollResult.data.content.length}`);
      console.log(`成功获取AI回复，会话完成: ${messageId}`);
      
      // 构造返回结果（无论数据库更新是否成功）
      const returnResult = {
        success: true,
        message_id: messageId,
        conversation_id: conversationId,
        created_at: new Date().toISOString()
      };
      
      // 在这里放入直接的内联清理代码，不再调用任何外部函数
      console.log("开始清理Markdown格式...");

      // 确保数据存在
      if (!pollResult || !pollResult.data || !pollResult.data.content) {
        console.log("警告：未找到需要清理的内容");
        returnResult.content = "";
      } else {
        // 内联实现的Markdown清理，不依赖外部函数
        let content = pollResult.data.content;
        
        // 检查内容是否与原始查询相同，避免返回用户的问题
        if (content.trim() === query.trim()) {
          console.log("警告：AI回复与用户查询相同，可能出现了交互问题");
          returnResult.content = "抱歉，系统暂时无法处理您的请求，请稍后再试或尝试其他问题。";
          returnResult.success = false;
          returnResult.error = { message: "AI回复与用户查询相同，可能出现了交互问题" };
          // 直接返回错误，不继续处理
          return returnResult;
        }
        
        try {
          // 只在内容是字符串时进行处理
          if (typeof content === 'string') {
            // 清理Markdown标记
            // 替换标题标记
            content = content.replace(/^#+\s+(.*)$/gm, '$1');
            
            // 替换粗体和斜体
            content = content.replace(/\*\*\*([^*]+)\*\*\*/g, '$1'); // 先处理三星号
            content = content.replace(/\*\*([^*]+)\*\*/g, '$1');
            content = content.replace(/\*([^*]+)\*/g, '$1');
            
            // 替换列表标记
            content = content.replace(/^\s*[-*]\s+/gm, '• ');
            content = content.replace(/^\s*\d+\.\s+/gm, '• ');
            
            // 移除代码块标记
            content = content.replace(/```[a-z]*\n/g, '');
            content = content.replace(/```\n/g, '');
            
            // 替换链接
            content = content.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
            
            // 保留图片链接，但格式更友好
            content = content.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, '[图片]');
            
            // 移除多余空行
            content = content.replace(/\n{3,}/g, '\n\n');
          }
          
          console.log("Markdown格式清理完成");
          returnResult.content = content;
        } catch (e) {
          console.error("清理Markdown失败:", e);
          returnResult.content = pollResult.data.content;
        }
      }
      
      // 如果有图片，添加到返回结果中
      if (pollResult.data.images && pollResult.data.images.length > 0) {
        console.log(`返回${pollResult.data.images.length}张图片`);
        returnResult.images = pollResult.data.images;
        
        // 详细记录每个图片的URL
        returnResult.images.forEach((img, idx) => {
          console.log(`- 图片${idx + 1}: ${img.url}`);
        });
        
        // 添加渲染指南
        returnResult.rendering_guide = {
          image_count: returnResult.images.length,
          has_images: true,
          recommendation: "建议以图片墙的形式显示图片，每行显示3张图片"
        };
        
        // 优化图片URL格式
        returnResult.images = returnResult.images.map((img, index) => {
          if (!img.url) return img;
          
          // 确保URL适合小程序使用
          let optimizedUrl = img.url;
          
          // 检查是否是Coze的图片URL
          if (optimizedUrl.includes('coze.cn')) {
            // 记录原始URL
            console.log(`处理图片${index+1}原始URL: ${optimizedUrl}`);
            
            // 确保有正确的参数，避免缓存问题
            if (!optimizedUrl.includes('?')) {
              optimizedUrl += `?t=${Date.now()}`;
            } else if (!optimizedUrl.includes('t=')) {
              optimizedUrl += `&t=${Date.now()}`;
            }
            
            // 记录优化后的URL
            console.log(`处理图片${index+1}优化后URL: ${optimizedUrl}`);
          }
          
          return {
            ...img,
            url: optimizedUrl,
            mpUrl: optimizedUrl // 专门为小程序添加的字段
          };
        });
      } else {
        // 检查是否有图片URL在内容中，但没有被提取为图片对象
        console.log('检查内容中是否包含未提取的图片URL...');
        
        // 没有找到任何图片
        console.log('未找到任何图片，返回结果将不包含图片数据');
        returnResult.images = [];
        returnResult.rendering_guide = {
          image_count: 0,
          has_images: false
        };
      }
      
      // 记录最终的完整返回结果（限制长度）
      const resultPreview = JSON.stringify(returnResult).substring(0, 500) + 
                          (JSON.stringify(returnResult).length > 500 ? '...' : '');
      console.log(`返回结果: ${resultPreview}`);

      return returnResult;
    } else {
      // 如果轮询失败，返回错误信息
      console.log('轮询未成功，返回错误信息');
      return {
        success: false,
        error: pollResult.data ? { message: pollResult.data.error_message } : { message: '未知错误' },
        message: pollResult.data && pollResult.data.error_message ? pollResult.data.error_message : '轮询消息失败'
      };
    }
  } catch (error) {
    console.error('调用AI服务出错:', error);
    
    // 尝试更新数据库状态
    if (messageId) {
      try {
        const conversations = db.collection('conversations');
        await conversations.doc(messageId).update({
          data: {
            status: 'error',
            error_message: error.message,
            error_at: new Date()
          }
        });
      } catch (dbError) {
        console.error('更新错误状态失败:', dbError);
        // 继续执行，不中断流程
      }
    } else {
      console.log('messageId为空，跳过更新错误状态');
    }
    
    return {
      success: false,
      error: { message: error.message },
      message: `调用AI服务失败: ${error.message}`
    };
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  logEnvironmentInfo();
  
  // 获取微信用户信息
  const wxContext = cloud.getWXContext();
  const openId = event.openid || wxContext.OPENID;
  
  // 获取动作类型
  const { action, apiSettings } = event;
  
  // 根据action参数执行不同操作
  if (action === 'getStreamUrl') {
    try {
      console.log('处理getStreamUrl请求');
      const { query } = event;
      
      // 检查必要参数
      if (!query) {
        return {
          success: false,
          message: '查询内容不能为空'
        };
      }
      
      // 使用API设置
      const finalApiKey = (apiSettings && apiSettings.apiKey) || COZE_API_KEY;
      const finalBotId = (apiSettings && apiSettings.botId) || BOT_ID;
      
      // 构建流式URL和请求数据
      const streamUrl = 'https://api.coze.cn/v3/chat/streaming';
      const requestData = {
        bot_id: finalBotId,
        user_id: openId || 'anonymous',
        query: query
      };
      
      console.log('生成流式API URL成功:', streamUrl);
      console.log('请求数据:', JSON.stringify(requestData));
      
      return {
        success: true,
        stream_url: streamUrl,
        request_data: requestData
      };
    } catch (error) {
      console.error('生成流式API URL失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  else if (action === 'checkStatus') {
    try {
      console.log('处理checkStatus请求');
      const { messageId, conversationId } = event;
      
      if (!messageId) {
        return {
          success: false,
          message: '消息ID不能为空'
        };
      }
      
      // 模拟检查状态
      return {
        success: true,
        status: 'completed',
        completed: true,
        data: {
          status: 'completed'
        }
      };
    } catch (error) {
      console.error('检查消息状态失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  else if (action === 'forceComplete') {
    try {
      console.log('处理forceComplete请求');
      const { messageId } = event;
      
      if (!messageId) {
        return {
          success: false,
          message: '消息ID不能为空'
        };
      }
      
      // 模拟强制完成
      return {
        success: true,
        status: 'completed',
        completed: true,
        force_completed: true
      };
    } catch (error) {
      console.error('强制完成消息失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  else {
    // 默认处理常规查询
    
    // 获取会话ID、查询内容和选项
    const { conversation_id: existingConversationId, query, options = {}, botId, message } = event;
    
    // 如果传入了message参数，优先使用它作为query
    const finalQuery = message || query;
    
    // 合并options，确保botId被传递
    const finalOptions = {
      ...options,
      botId: botId || options.botId || options.bot_id // 支持多种传参方式
    };
    
    // 记录最终使用的参数
    console.log('最终使用的参数:', JSON.stringify({
      finalQuery,
      existingConversationId,
      finalOptions
    }));
    
    if (!finalQuery) {
      return {
        success: false,
        message: '消息内容不能为空'
      };
    }
    
    // 尝试初始化数据库集合
    try {
      // 检查并创建必要的集合
      await ensureCollectionsExist();
    } catch (dbInitError) {
      console.error('初始化数据库集合失败:', dbInitError);
      // 继续执行，不中断流程
    }
    
    try {
      // 调用AI并返回结果
      console.log(`开始调用AI服务，处理用户查询: "${finalQuery.substring(0, 50)}${finalQuery.length > 50 ? '...' : ''}"`);
      const result = await callAI(finalQuery, openId, null, existingConversationId, finalOptions);
      
      // 检查结果是否有效
      if (result && result.success) {
        // 检查内容是否与查询相同（额外的安全检查）
        if (result.content && result.content.trim() === finalQuery.trim()) {
          console.log('警告: 返回的内容与用户查询相同，返回错误信息');
          return {
            success: false,
            message: '系统暂时无法生成有效回复，请稍后再试',
            error: { message: '返回内容与用户查询相同' }
          };
        }
        
        console.log(`成功获取AI回复，长度: ${result.content ? result.content.length : 0}`);
      } else {
        console.log(`调用AI失败: ${result.message || '未知错误'}`);
      }
      
      return result;
    } catch (error) {
      console.error('处理消息失败:', error);
      return {
        success: false,
        message: error.message || '服务器内部错误'
      };
    }
  }
};

// 确保必要的集合存在
async function ensureCollectionsExist() {
  try {
    const collections = ['conversations', 'messages', 'users'];
    
    for (const collName of collections) {
      try {
        // 尝试创建集合（如果已存在会抛出错误，我们捕获并忽略）
        await db.createCollection(collName);
        console.log(`成功创建集合: ${collName}`);
      } catch (err) {
        // 检查错误类型，如果是集合已存在，则忽略错误
        if (err.errCode === -501001 || (err.errMsg && err.errMsg.includes('collection already exists'))) {
          console.log(`集合已存在: ${collName}`);
        } else {
          console.error(`创建集合${collName}失败:`, err);
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error('确保集合存在时出错:', error);
    return false;
  }
}

// 记录用户请求
async function logUserRequest(openid, requestData) {
  try {
    await db.collection('usage_records').add({
      data: {
        openid: openid,
        botId: requestData.botId,
        requestType: 'chat',
        timestamp: db.serverDate(),
        requestData: {
          messageCount: requestData.messages ? requestData.messages.length : 0
        }
      }
    })
  } catch (error) {
    console.error('记录用户请求失败:', error)
  }
}

// 记录 API 响应
async function logApiResponse(openid, botId, isSuccess, errorMsg = '') {
  try {
    await db.collection('api_responses').add({
      data: {
        openid: openid,
        botId: botId,
        timestamp: db.serverDate(),
        isSuccess: isSuccess,
        errorMsg: errorMsg
      }
    })
  } catch (error) {
    console.error('记录 API 响应失败:', error)
  }
} 