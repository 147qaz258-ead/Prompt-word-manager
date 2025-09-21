// PromptMaster Chrome Extension - Service Worker
// 基于Manifest V3的Service Worker，使用模块化架构

import { CONFIG, MESSAGE_TYPES, ERROR_CODES } from './modules/config.js';
import { Logger, ErrorHandler, TimeUtils } from './modules/utils.js';
import { feishuApiService } from './modules/feishu-api.js';
import { storageManager } from './modules/storage.js';

// Service Worker 生命周期管理
let keepAliveInterval;
let autoRefreshInterval;

/**
 * 初始化Service Worker
 */
async function initialize() {
  try {
    Logger.info('PromptMaster Service Worker 初始化开始');

    // 初始化存储管理器
    await storageManager.init();

    // 加载配置
    const feishuConfig = storageManager.getFeishuConfig();
    await feishuApiService.initConfig(feishuConfig);

    // 设置消息监听器
    setupMessageListeners();

    // 设置上下文菜单
    setupContextMenu();

    // 启动保持活跃机制
    startKeepAlive();

    // 启动自动刷新
    await startAutoRefresh();

    Logger.info('PromptMaster Service Worker 初始化完成');

  } catch (error) {
    Logger.error('Service Worker 初始化失败', { error });
  }
}

/**
 * 设置消息监听器
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleIncomingMessage(request, sender)
      .then(response => {
        sendResponse(response);
      })
      .catch(error => {
        const errorInfo = ErrorHandler.handleError(error, 'Background', 'handleMessage');
        sendResponse({
          success: false,
          error: errorInfo.userMessage || error.message,
          code: errorInfo.code
        });
      });

    return true; // 保持消息通道开放以支持异步响应
  });

  Logger.debug('消息监听器设置完成');
}

/**
 * 处理接收到的消息
 */
async function handleIncomingMessage(request, sender) {
  const { action, ...params } = request;

  Logger.debug('接收到消息', { action, params });

  switch (action) {
    // 搜索相关
    case MESSAGE_TYPES.SEARCH_PROMPTS:
      return await handleSearchPrompts(params);

    // 连接测试
    case MESSAGE_TYPES.CHECK_CONNECTION:
      return await handleCheckConnection();

    // 设置管理
    case MESSAGE_TYPES.SAVE_SETTINGS:
      return await handleSaveSettings(params);

    // 数据刷新
    case MESSAGE_TYPES.MANUAL_REFRESH:
      return await handleManualRefresh();

    // 缓存管理
    case MESSAGE_TYPES.CLEAR_CACHE:
      return await handleClearCache();

    // 永久数据管理
    case MESSAGE_TYPES.GET_PERMANENT_PROMPTS_INFO:
      return await handleGetPermanentPromptsInfo();

    case MESSAGE_TYPES.CLEAR_PERMANENT_PROMPTS:
      return await handleClearPermanentPrompts();

    // 自动刷新设置
    case MESSAGE_TYPES.SET_AUTO_REFRESH_SETTINGS:
      return await handleSetAutoRefreshSettings(params);

    // 捕获相关
    case MESSAGE_TYPES.CAPTURE_PROMPT:
      return await handleCapturePrompt(params);

    case MESSAGE_TYPES.COPY_TO_CLIPBOARD:
      return await handleCopyToClipboard(params);

    // 选择器相关
    case MESSAGE_TYPES.SHOW_SELECTOR:
      return await handleShowSelector(params);

    // UI相关
    case MESSAGE_TYPES.TOGGLE_POPUP:
      return await handleTogglePopup(params);

    default:
      Logger.warn('未知的消息类型', { action });
      return {
        success: false,
        error: '未知的消息类型',
        code: ERROR_CODES.UNKNOWN_ERROR
      };
  }
}

/**
 * 处理搜索提示词
 */
async function handleSearchPrompts(params) {
  try {
    const { keyword, filter = {} } = params;
    const settings = storageManager.getSettings();

    // 限制搜索结果数量
    const maxResults = Math.min(
      params.pageSize || 50,
      settings.maxRecentItems || 10
    );

    // 先搜索缓存和永久数据
    const cachedResults = await searchInCache(keyword, filter, maxResults);
    if (cachedResults.length > 0) {
      return {
        success: true,
        data: {
          prompts: cachedResults,
          total: cachedResults.length,
          hasMore: false,
          pageToken: null,
          source: 'cache'
        }
      };
    }

    // 如果没有缓存结果，搜索飞书API
    const apiResponse = await feishuApiService.searchPrompts(keyword, {
      pageSize: maxResults,
      filter
    });

    if (apiResponse.success) {
      // 添加到最近使用
      if (apiResponse.data.prompts.length > 0) {
        await storageManager.addRecentPrompt(apiResponse.data.prompts[0]);
      }
    }

    return apiResponse;

  } catch (error) {
    Logger.error('搜索提示词失败', { params, error });
    return {
      success: false,
      error: error.message,
      data: { prompts: [], total: 0, hasMore: false, pageToken: null }
    };
  }
}

/**
 * 在缓存中搜索提示词
 */
async function searchInCache(keyword, filter, maxResults) {
  const results = [];

  // 搜索永久数据
  const permanentPrompts = await storageManager.getPermanentPrompts();
  if (permanentPrompts.prompts) {
    const filtered = permanentPrompts.prompts.filter(prompt => {
      if (keyword && !prompt.prompt.toLowerCase().includes(keyword.toLowerCase())) {
        return false;
      }
      if (filter.category && prompt.category !== filter.category) {
        return false;
      }
      return true;
    });

    results.push(...filtered.slice(0, maxResults));
  }

  // 搜索最近使用
  const recentPrompts = await storageManager.getRecentPrompts();
  if (recentPrompts.length > 0) {
    const filtered = recentPrompts.filter(item => {
      if (keyword && !item.prompt.toLowerCase().includes(keyword.toLowerCase())) {
        return false;
      }
      return true;
    });

    results.push(...filtered.slice(0, maxResults - results.length));
  }

  return results;
}

/**
 * 处理连接测试
 */
async function handleCheckConnection() {
  try {
    const result = await feishuApiService.testConnection();
    return {
      success: true,
      data: result
    };
  } catch (error) {
    Logger.error('连接测试失败', { error });
    return {
      success: false,
      error: error.message,
      data: { connected: false, message: error.message }
    };
  }
}

/**
 * 处理保存设置
 */
async function handleSaveSettings(params) {
  try {
    const { settings, feishuConfig } = params;

    // 保存设置
    if (settings) {
      await storageManager.saveSettings(settings);
    }

    // 保存飞书配置
    if (feishuConfig) {
      await storageManager.saveFeishuConfig(feishuConfig);
      await feishuApiService.initConfig(feishuConfig);
    }

    // 重启自动刷新
    await restartAutoRefresh();

    return {
      success: true,
      message: '设置保存成功'
    };

  } catch (error) {
    Logger.error('保存设置失败', { params, error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 处理手动刷新
 */
async function handleManualRefresh() {
  try {
    Logger.info('开始手动刷新数据');

    // 获取所有提示词
    const response = await feishuApiService.getAllPrompts();

    if (response.success) {
      // 保存到永久存储
      await storageManager.savePermanentPrompts(response.data.prompts);
      await storageManager.saveLastRefreshTime();

      Logger.info('手动刷新完成', { count: response.data.total });

      return {
        success: true,
        data: {
          ...response.data,
          lastRefreshTime: TimeUtils.formatTimestamp(Date.now())
        }
      };
    } else {
      throw new Error(response.error);
    }

  } catch (error) {
    Logger.error('手动刷新失败', { error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 处理清除缓存
 */
async function handleClearCache() {
  try {
    await storageManager.clearCache();
    feishuApiService.clearCache();

    return {
      success: true,
      message: '缓存清除成功'
    };
  } catch (error) {
    Logger.error('清除缓存失败', { error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 处理获取永久提示词信息
 */
async function handleGetPermanentPromptsInfo() {
  try {
    const info = await storageManager.getPermanentPromptsInfo();
    return {
      success: true,
      data: info
    };
  } catch (error) {
    Logger.error('获取永久提示词信息失败', { error });
    return {
      success: false,
      error: error.message,
      data: { hasPermanentData: false, count: 0, lastUpdated: null }
    };
  }
}

/**
 * 处理清除永久提示词
 */
async function handleClearPermanentPrompts() {
  try {
    await storageManager.clearPermanentPrompts();
    return {
      success: true,
      message: '永久数据清除成功'
    };
  } catch (error) {
    Logger.error('清除永久提示词失败', { error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 处理设置自动刷新
 */
async function handleSetAutoRefreshSettings(params) {
  try {
    const { enabled, interval } = params;

    if (enabled) {
      await startAutoRefresh(interval);
    } else {
      stopAutoRefresh();
    }

    return {
      success: true,
      message: `自动刷新已${enabled ? '启用' : '禁用'}`
    };
  } catch (error) {
    Logger.error('设置自动刷新失败', { params, error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 处理捕获提示词
 */
async function handleCapturePrompt(params) {
  try {
    const { prompt, source } = params;

    // 保存到最近使用
    await storageManager.addRecentPrompt({
      id: `captured_${Date.now()}`,
      prompt: prompt,
      category: '捕获',
      capturedAt: Date.now()
    });

    Logger.info('提示词捕获成功', { source, length: prompt.length });

    return {
      success: true,
      message: '提示词捕获成功'
    };

  } catch (error) {
    Logger.error('捕获提示词失败', { params, error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 处理复制到剪贴板
 */
async function handleCopyToClipboard(params) {
  try {
    const { text } = params;

    // 这里需要通过content script来执行实际的复制操作
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (activeTabs.length > 0) {
      await chrome.tabs.sendMessage(activeTabs[0].id, {
        action: MESSAGE_TYPES.COPY_TO_CLIPBOARD,
        text
      });
    }

    return {
      success: true,
      message: '文本已复制到剪贴板'
    };

  } catch (error) {
    Logger.error('复制到剪贴板失败', { params, error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 处理显示选择器
 */
async function handleShowSelector(params) {
  try {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (activeTabs.length > 0) {
      await chrome.tabs.sendMessage(activeTabs[0].id, {
        action: MESSAGE_TYPES.SHOW_SELECTOR,
        ...params
      });
    }

    return {
      success: true,
      message: '选择器已显示'
    };

  } catch (error) {
    Logger.error('显示选择器失败', { params, error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 处理切换弹窗
 */
async function handleTogglePopup(params) {
  try {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (activeTabs.length > 0) {
      await chrome.tabs.sendMessage(activeTabs[0].id, {
        action: MESSAGE_TYPES.TOGGLE_POPUP,
        ...params
      });
    }

    return {
      success: true,
      message: '弹窗状态已切换'
    };

  } catch (error) {
    Logger.error('切换弹窗失败', { params, error });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 设置上下文菜单
 */
function setupContextMenu() {
  try {
    chrome.contextMenus.create({
      id: 'capturePrompt',
      title: '捕获为提示词',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'searchPrompt',
      title: '搜索提示词',
      contexts: ['selection']
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
      handleContextMenuClick(info, tab);
    });

    Logger.debug('上下文菜单设置完成');
  } catch (error) {
    Logger.error('设置上下文菜单失败', { error });
  }
}

/**
 * 处理上下文菜单点击
 */
async function handleContextMenuClick(info, tab) {
  try {
    if (info.menuItemId === 'capturePrompt' && info.selectionText) {
      await handleCapturePrompt({
        prompt: info.selectionText,
        source: 'contextMenu'
      });
    } else if (info.menuItemId === 'searchPrompt' && info.selectionText) {
      // 在当前标签页中搜索选中的文本
      await chrome.tabs.sendMessage(tab.id, {
        action: MESSAGE_TYPES.SEARCH_PROMPTS,
        keyword: info.selectionText
      });
    }
  } catch (error) {
    Logger.error('处理上下文菜单点击失败', { info, error });
  }
}

/**
 * 启动保持活跃机制
 */
function startKeepAlive() {
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // 简单的操作来保持 Service Worker 活跃
    });
  }, 20000); // 每20秒执行一次

  Logger.debug('保持活跃机制已启动');
}

/**
 * 停止保持活跃机制
 */
function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  Logger.debug('保持活跃机制已停止');
}

/**
 * 启动自动刷新
 */
async function startAutoRefresh(interval = null) {
  try {
    stopAutoRefresh();

    const settings = storageManager.getSettings();
    const refreshInterval = interval || settings.autoRefresh?.interval || 30;

    if (settings.autoRefresh?.enabled !== false) {
      autoRefreshInterval = setInterval(async () => {
        try {
          await handleManualRefresh();
        } catch (error) {
          Logger.error('自动刷新失败', { error });
        }
      }, refreshInterval * 60 * 1000);

      Logger.info('自动刷新已启动', { interval: refreshInterval });
    }
  } catch (error) {
    Logger.error('启动自动刷新失败', { error });
  }
}

/**
 * 停止自动刷新
 */
function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
  Logger.debug('自动刷新已停止');
}

/**
 * 重启自动刷新
 */
async function restartAutoRefresh() {
  try {
    await startAutoRefresh();
    Logger.debug('自动刷新已重启');
  } catch (error) {
    Logger.error('重启自动刷新失败', { error });
  }
}

/**
 * Service Worker 安装事件
 */
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') {
      Logger.info('PromptMaster 扩展已安装');
    } else if (details.reason === 'update') {
      Logger.info('PromptMaster 扩展已更新', { previousVersion: details.previousVersion });
    }

    // 初始化扩展
    initialize();
  } catch (error) {
    Logger.error('扩展安装/更新事件处理失败', { details, error });
  }
});

/**
 * Service Worker 启动事件
 */
chrome.runtime.onStartup.addListener(() => {
  try {
    Logger.info('Service Worker 启动');
    initialize();
  } catch (error) {
    Logger.error('Service Worker 启动失败', { error });
  }
});

/**
 * Service Worker 激活事件
 */
chrome.runtime.onActivated.addListener(() => {
  try {
    Logger.debug('Service Worker 已激活');
  } catch (error) {
    Logger.error('Service Worker 激活失败', { error });
  }
});

/**
 * 在扩展启动时初始化
 */
initialize();

/**
 * 清理资源（在扩展卸载或更新时）
 */
chrome.runtime.onSuspend.addListener(() => {
  try {
    stopKeepAlive();
    stopAutoRefresh();
    Logger.info('Service Worker 已暂停');
  } catch (error) {
    Logger.error('Service Worker 暂停失败', { error });
  }
});

// 导出给测试使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initialize,
    handleIncomingMessage,
    startAutoRefresh,
    stopAutoRefresh
  };
}