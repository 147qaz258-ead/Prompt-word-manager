// PromptMaster Chrome Extension - 选项页面脚本
// 处理飞书API配置和插件设置

// 配置常量
const CONFIG = {
  STORAGE_KEYS: {
    SETTINGS: 'promptmaster_settings',
    FEISHU_CONFIG: 'promptmaster_feishu_config'
  }
};

// 默认设置
const DEFAULT_SETTINGS = {
  triggerChar: '/',
  theme: 'auto',
  shortcuts: {
    capture: 'Ctrl+Shift+S',
    toggle: 'Ctrl+Shift+P'
  },
  autoSave: true,
  maxRecentItems: 10,
  autoRefresh: {
    enabled: true,
    interval: 30 // 单位：分钟
  }
};

// DOM 元素
const elements = {
  // 配置模式选择
  modeBenefit: document.getElementById('modeBenefit'),
  modeCustom: document.getElementById('modeCustom'),
  customConfigSection: document.getElementById('customConfigSection'),

  // 飞书配置
  appId: document.getElementById('appId'),
  appSecret: document.getElementById('appSecret'),
  bitableAppToken: document.getElementById('bitableAppToken'),
  bitableTableId: document.getElementById('bitableTableId'),
  
  // 插件设置
  triggerChar: document.getElementById('triggerChar'),
  maxRecentItems: document.getElementById('maxRecentItems'),
  autoRefreshEnabled: document.getElementById('autoRefreshEnabled'),
  autoRefreshInterval: document.getElementById('autoRefreshInterval'),
  
  // 按钮
  testConnection: document.getElementById('testConnection'),
  saveSettings: document.getElementById('saveSettings'),
  resetSettings: document.getElementById('resetSettings'),
  refreshData: document.getElementById('refreshData'),
  clearPermanentData: document.getElementById('clearPermanentData'),
  
  // 状态显示
  connectionStatus: document.getElementById('connectionStatus'),
  statusMessage: document.getElementById('statusMessage'),
  testText: document.getElementById('testText'),
  testLoading: document.getElementById('testLoading'),
  permanentDataInfo: document.getElementById('permanentDataInfo')
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  console.log('PromptMaster 选项页面已加载');
  
  // 加载设置
  await loadSettings();
  
  // 检查连接状态
  await checkConnectionStatus();
  
  // 检查永久数据状态
  await checkPermanentDataStatus();
  
  // 绑定事件
  bindEvents();
});

/**
 * 绑定事件监听器
 */
function bindEvents() {
  // 配置模式切换
  if (elements.modeBenefit && elements.modeCustom) {
    elements.modeBenefit.addEventListener('change', handleConfigModeChange);
    elements.modeCustom.addEventListener('change', handleConfigModeChange);

    // 初始化模式选择器UI
    initializeModeSelectors();
  }

  // 测试连接
  if (elements.testConnection) {
    elements.testConnection.addEventListener('click', handleTestConnection);
    console.log('测试连接按钮事件已绑定');
  } else {
    console.error('测试连接按钮元素未找到');
  }
  
  // 保存设置
  elements.saveSettings.addEventListener('click', handleSaveSettings);
  
  // 重置设置
  elements.resetSettings.addEventListener('click', handleResetSettings);
  
  // 刷新数据
  elements.refreshData.addEventListener('click', handleRefreshData);
  
  // 清除永久数据
  elements.clearPermanentData.addEventListener('click', handleClearPermanentData);
  
  // 输入框变化时清除状态
  const inputs = [elements.appId, elements.appSecret, elements.bitableAppToken, elements.bitableTableId];
  inputs.forEach(input => {
    if (input) {
      input.addEventListener('input', () => {
        hideStatus();
        updateConnectionStatus(false, '配置已修改，请重新测试连接');
      });
    }
  });
}

/**
 * 初始化模式选择器UI
 */
function initializeModeSelectors() {
  const modeOptions = document.querySelectorAll('.mode-option');

  modeOptions.forEach(option => {
    option.addEventListener('click', () => {
      const mode = option.dataset.mode;
      const radio = option.querySelector('input[type="radio"]');

      if (radio) {
        radio.checked = true;
        handleConfigModeChange({ target: radio });
      }
    });
  });

  // 初始化当前选择的模式
  const currentMode = elements.modeBenefit?.checked ? 'benefit' : 'custom';
  updateConfigUI(currentMode);
}

/**
 * 处理配置模式变化
 */
async function handleConfigModeChange(event) {
  const mode = event.target.value;

  // 更新UI
  updateConfigUI(mode);

  // 保存配置模式
  try {
    await chrome.storage.sync.set({ 'promptmaster_config_mode': mode });
    console.log(`配置模式已切换为: ${mode}`);
  } catch (error) {
    console.error('保存配置模式失败:', error);
  }
}

/**
 * 更新配置UI
 */
function updateConfigUI(mode) {
  const modeOptions = document.querySelectorAll('.mode-option');

  // 更新模式选项的选中状态
  modeOptions.forEach(option => {
    if (option.dataset.mode === mode) {
      option.classList.add('selected');
    } else {
      option.classList.remove('selected');
    }
  });

  // 显示/隐藏自定义配置区域
  if (elements.customConfigSection) {
    if (mode === 'custom') {
      elements.customConfigSection.style.display = 'block';
    } else {
      elements.customConfigSection.style.display = 'none';
    }
  }
}

/**
 * 加载设置
 */
async function loadSettings() {
  try {
    // 加载配置模式
    const modeResult = await chrome.storage.sync.get(['promptmaster_config_mode']);
    const configMode = modeResult.promptmaster_config_mode || 'benefit';

    // 设置配置模式UI
    if (configMode === 'custom' && elements.modeCustom) {
      elements.modeCustom.checked = true;
    } else if (elements.modeBenefit) {
      elements.modeBenefit.checked = true;
    }

    // 更新配置UI
    updateConfigUI(configMode);

    // 加载飞书配置
    const feishuResult = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.FEISHU_CONFIG]);
    const feishuConfig = feishuResult[CONFIG.STORAGE_KEYS.FEISHU_CONFIG] || {};

    if (elements.appId) {
      elements.appId.value = feishuConfig.appId || '';
    }
    if (elements.appSecret) {
      elements.appSecret.value = feishuConfig.appSecret || '';
    }
    if (elements.bitableAppToken) {
      elements.bitableAppToken.value = feishuConfig.bitableAppToken || '';
    }
    if (elements.bitableTableId) {
      elements.bitableTableId.value = feishuConfig.bitableTableId || '';
    }
    
    // 加载插件设置
    const settingsResult = await chrome.storage.sync.get([CONFIG.STORAGE_KEYS.SETTINGS]);
    const settings = settingsResult[CONFIG.STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
    
    elements.triggerChar.value = settings.triggerChar || '/';
    elements.maxRecentItems.value = settings.maxRecentItems || 10;
    
    // 自动刷新设置
    if (settings.autoRefresh) {
      elements.autoRefreshEnabled.checked = settings.autoRefresh.enabled !== false;
      elements.autoRefreshInterval.value = settings.autoRefresh.interval || 30;
    } else {
      elements.autoRefreshEnabled.checked = true;
      elements.autoRefreshInterval.value = 30;
    }
    
    console.log('设置加载完成');
  } catch (error) {
    console.error('加载设置失败:', error);
    showStatus('error', '加载设置失败: ' + error.message);
  }
}

/**
 * 检查连接状态
 */
async function checkConnectionStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'checkConnection'
    });
    
    if (response.success) {
      updateConnectionStatus(response.data.connected, 
        response.data.connected ? '已连接到飞书' : '未连接到飞书');
    } else {
      updateConnectionStatus(false, '检查连接失败');
    }
  } catch (error) {
    console.error('检查连接状态失败:', error);
    updateConnectionStatus(false, '检查连接失败');
  }
}

/**
 * 更新连接状态显示
 */
function updateConnectionStatus(connected, message) {
  const statusElement = elements.connectionStatus;
  const dotElement = statusElement.querySelector('.status-dot');
  const textElement = statusElement.querySelector('span');
  
  // 更新样式
  statusElement.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
  dotElement.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  textElement.textContent = message;
}

/**
 * 处理测试连接
 */
async function handleTestConnection() {
  console.log('开始测试连接...');

  // 获取当前配置模式
  const currentMode = elements.modeCustom?.checked ? 'custom' : 'benefit';
  console.log('当前配置模式:', currentMode);

  let config;
  if (currentMode === 'custom') {
    config = getFeishuConfig();
    console.log('获取到自定义配置:', config);

    // 验证配置
    if (!validateFeishuConfig(config)) {
      console.log('自定义配置验证失败');
      return;
    }
  } else {
    // 福利模式不需要用户配置
    config = {};
    console.log('福利模式，使用内置配置');
  }
  
  // 显示加载状态
  setTestingState(true);
  hideStatus();
  
  try {
    console.log('保存配置到存储...');
    // 临时保存配置用于测试
    await chrome.storage.sync.set({ [CONFIG.STORAGE_KEYS.FEISHU_CONFIG]: config });
    
    console.log('清除缓存...');
    // 清除缓存的token
    await chrome.runtime.sendMessage({ action: 'clearCache' });
    
    console.log('发送连接测试请求...');
    // 测试连接
    const response = await chrome.runtime.sendMessage({
      action: 'checkConnection'
    });
    
    console.log('测试连接响应:', response);
    
    if (response && response.success) {
      if (response.data && response.data.connected) {
        showStatus('success', '连接测试成功！飞书API配置正确。');
        updateConnectionStatus(true, '已连接到飞书');
      } else {
        showStatus('error', '连接测试失败，请检查配置信息。');
        updateConnectionStatus(false, '连接失败');
      }
    } else {
      const errorMsg = response?.error || '未知错误';
      showStatus('error', '连接测试失败: ' + errorMsg);
      updateConnectionStatus(false, '连接失败');
    }
  } catch (error) {
    console.error('测试连接失败:', error);
    showStatus('error', '测试连接失败: ' + error.message);
    updateConnectionStatus(false, '连接失败');
  } finally {
    setTestingState(false);
  }
}

/**
 * 处理保存设置
 */
async function handleSaveSettings() {
  try {
    const feishuConfig = getFeishuConfig();
    const settings = getSettings();

    // 获取当前配置模式
    const currentMode = elements.modeCustom?.checked ? 'custom' : 'benefit';

    // 验证配置
    if (currentMode === 'custom' && !validateFeishuConfig(feishuConfig)) {
      return;
    }

    if (!validateSettings(settings)) {
      return;
    }

    // 保存配置
    await chrome.storage.sync.set({
      [CONFIG.STORAGE_KEYS.FEISHU_CONFIG]: feishuConfig,
      [CONFIG.STORAGE_KEYS.SETTINGS]: settings,
      'promptmaster_config_mode': currentMode
    });
    
    showStatus('success', '设置保存成功！');
    
    // 重新检查连接状态
    setTimeout(checkConnectionStatus, 1000);
    
    // 重启自动刷新服务
    try {
      await chrome.runtime.sendMessage({
        action: 'setAutoRefreshSettings',
        enabled: settings.autoRefresh.enabled,
        interval: settings.autoRefresh.interval
      });
    } catch (error) {
      console.error('重启自动刷新服务失败:', error);
    }
    
    console.log('设置保存成功');
  } catch (error) {
    console.error('保存设置失败:', error);
    showStatus('error', '保存设置失败: ' + error.message);
  }
}

/**
 * 处理重置设置
 */
async function handleResetSettings() {
  if (!confirm('确定要重置所有设置吗？此操作不可撤销。')) {
    return;
  }

  try {
    // 清除存储的配置
    await chrome.storage.sync.remove([CONFIG.STORAGE_KEYS.FEISHU_CONFIG, CONFIG.STORAGE_KEYS.SETTINGS, 'promptmaster_config_mode']);

    // 重置为福利模式
    if (elements.modeBenefit) {
      elements.modeBenefit.checked = true;
    }
    if (elements.modeCustom) {
      elements.modeCustom.checked = false;
    }
    updateConfigUI('benefit');

    // 重置表单
    if (elements.appId) {
      elements.appId.value = '';
    }
    if (elements.appSecret) {
      elements.appSecret.value = '';
    }
    if (elements.bitableAppToken) {
      elements.bitableAppToken.value = '';
    }
    if (elements.bitableTableId) {
      elements.bitableTableId.value = '';
    }
    elements.triggerChar.value = DEFAULT_SETTINGS.triggerChar;
    elements.maxRecentItems.value = DEFAULT_SETTINGS.maxRecentItems;
    elements.autoRefreshEnabled.checked = DEFAULT_SETTINGS.autoRefresh.enabled;
    elements.autoRefreshInterval.value = DEFAULT_SETTINGS.autoRefresh.interval;
    
    // 更新状态
    updateConnectionStatus(false, '未连接到飞书');
    showStatus('info', '设置已重置为默认值');
    
    console.log('设置已重置');
  } catch (error) {
    console.error('重置设置失败:', error);
    showStatus('error', '重置设置失败: ' + error.message);
  }
}

/**
 * 获取飞书配置
 */
function getFeishuConfig() {
  return {
    appId: elements.appId ? elements.appId.value.trim() : '',
    appSecret: elements.appSecret ? elements.appSecret.value.trim() : '',
    bitableAppToken: elements.bitableAppToken ? elements.bitableAppToken.value.trim() : '',
    bitableTableId: elements.bitableTableId ? elements.bitableTableId.value.trim() : ''
  };
}

/**
 * 获取插件设置
 */
function getSettings() {
  return {
    ...DEFAULT_SETTINGS,
    triggerChar: elements.triggerChar.value.trim() || '/',
    maxRecentItems: parseInt(elements.maxRecentItems.value) || 10,
    autoRefresh: {
      enabled: elements.autoRefreshEnabled.checked,
      interval: parseInt(elements.autoRefreshInterval.value) || 30
    }
  };
}

/**
 * 验证飞书配置
 */
function validateFeishuConfig(config) {
  const errors = [];

  if (!config.appId) {
    errors.push('App ID 不能为空');
  } else if (!config.appId.startsWith('cli_')) {
    errors.push('App ID 格式不正确，应以 "cli_" 开头');
  }

  if (!config.appSecret) {
    errors.push('App Secret 不能为空');
  }

  if (!config.bitableAppToken) {
    errors.push('多维表格 App Token 不能为空');
  }

  if (!config.bitableTableId) {
    errors.push('数据表 ID 不能为空');
  } else if (!config.bitableTableId.startsWith('tbl')) {
    errors.push('数据表 ID 格式不正确，应以 "tbl" 开头');
  }

  if (errors.length > 0) {
    showStatus('error', '配置验证失败:\n' + errors.join('\n'));
    return false;
  }

  return true;
}

/**
 * 验证插件设置
 */
function validateSettings(settings) {
  const errors = [];
  
  if (!settings.triggerChar) {
    errors.push('触发字符不能为空');
  } else if (settings.triggerChar.length > 1) {
    errors.push('触发字符只能是单个字符');
  }
  
  if (settings.maxRecentItems < 5 || settings.maxRecentItems > 50) {
    errors.push('最近使用数量必须在 5-50 之间');
  }
  
  // 验证自动刷新设置
  if (settings.autoRefresh && settings.autoRefresh.interval) {
    const interval = settings.autoRefresh.interval;
    if (interval < 5) {
      errors.push('自动刷新间隔不能小于 5 分钟');
    } else if (interval > 1440) {
      errors.push('自动刷新间隔不能大于 1440 分钟 (24小时)');
    }
  }
  
  if (errors.length > 0) {
    showStatus('error', '设置验证失败:\n' + errors.join('\n'));
    return false;
  }
  
  return true;
}

/**
 * 设置测试状态
 */
function setTestingState(testing) {
  elements.testConnection.disabled = testing;
  elements.testText.style.display = testing ? 'none' : 'inline';
  elements.testLoading.style.display = testing ? 'inline-block' : 'none';
  
  if (testing) {
    elements.testConnection.style.opacity = '0.7';
  } else {
    elements.testConnection.style.opacity = '1';
  }
}

/**
 * 显示状态消息
 */
function showStatus(type, message) {
  const statusElement = elements.statusMessage;
  statusElement.className = `status ${type}`;
  statusElement.textContent = message;
  statusElement.style.display = 'block';
  
  // 自动隐藏成功消息
  if (type === 'success') {
    setTimeout(() => {
      hideStatus();
    }, 3000);
  }
}

/**
 * 隐藏状态消息
 */
function hideStatus() {
  elements.statusMessage.style.display = 'none';
}

/**
 * 检查永久数据状态
 */
async function checkPermanentDataStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getPermanentPromptsInfo'
    });
    
    if (response.success) {
      const { hasPermanentData, count, lastUpdated } = response.data;
      updatePermanentDataStatus(hasPermanentData, count, lastUpdated);
    } else {
      updatePermanentDataStatus(false, 0, null);
    }
  } catch (error) {
    console.error('检查永久数据状态失败:', error);
    updatePermanentDataStatus(false, 0, null);
  }
}

/**
 * 更新永久数据状态显示
 */
function updatePermanentDataStatus(hasData, count, lastUpdated) {
  const statusText = elements.permanentDataInfo.querySelector('.status-text');
  
  if (hasData && count > 0) {
    let statusMessage = `已保存 ${count} 条提示词数据`;
    if (lastUpdated) {
      statusMessage += `，最后刷新时间: ${lastUpdated}`;
    }
    statusText.textContent = statusMessage;
    statusText.style.color = '#28a745';
    elements.clearPermanentData.disabled = false;
  } else {
    statusText.textContent = '暂无永久数据';
    statusText.style.color = '#6c757d';
    elements.clearPermanentData.disabled = true;
  }
}

/**
 * 处理刷新数据
 */
async function handleRefreshData() {
  const config = getFeishuConfig();
  
  // 验证配置
  if (!validateFeishuConfig(config)) {
    return;
  }
  
  // 设置按钮状态
  elements.refreshData.disabled = true;
  elements.refreshData.textContent = '刷新中...';
  hideStatus();
  
  try {
    // 刷新数据
    const response = await chrome.runtime.sendMessage({
      action: 'manualRefresh'
    });
    
    if (response.success) {
      showStatus('success', `数据刷新成功！刷新时间: ${response.data.lastRefreshTime}`);
      
      // 更新永久数据状态
      await checkPermanentDataStatus();
    } else {
      showStatus('error', '数据刷新失败: ' + response.error);
    }
  } catch (error) {
    console.error('刷新数据失败:', error);
    showStatus('error', '数据刷新失败: ' + error.message);
  } finally {
    elements.refreshData.disabled = false;
    elements.refreshData.textContent = '刷新数据';
  }
}

/**
 * 处理清除永久数据
 */
async function handleClearPermanentData() {
  if (!confirm('确定要清除所有永久保存的提示词数据吗？此操作不可撤销。')) {
    return;
  }
  
  // 设置按钮状态
  elements.clearPermanentData.disabled = true;
  elements.clearPermanentData.textContent = '清除中...';
  hideStatus();
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'clearPermanentPrompts'
    });
    
    if (response.success) {
      showStatus('success', '永久数据已清除');
      
      // 更新永久数据状态
      await checkPermanentDataStatus();
    } else {
      showStatus('error', '清除永久数据失败');
    }
  } catch (error) {
    console.error('清除永久数据失败:', error);
    showStatus('error', '清除永久数据失败: ' + error.message);
  } finally {
    elements.clearPermanentData.disabled = false;
    elements.clearPermanentData.textContent = '清除永久数据';
  }
}

/**
 * 处理错误
 */
function handleError(error, context) {
  console.error(`${context}:`, error);
  showStatus('error', `${context}: ${error.message}`);
}

// 导出供其他脚本使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG,
    DEFAULT_SETTINGS,
    getFeishuConfig,
    getSettings,
    validateFeishuConfig,
    validateSettings
  };
}

console.log('PromptMaster 选项页面脚本已加载');