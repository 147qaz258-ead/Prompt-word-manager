// Popup Script - Chrome Extension Popup Interface
// 负责处理弹窗界面的交互逻辑

// 配置常量
const CONFIG = {
  SEARCH_DEBOUNCE_DELAY: 300,
  MAX_RECENT_ITEMS: 10,
  MAX_FAVORITES_ITEMS: 5,
  CACHE_DURATION: 5 * 60 * 1000, // 5分钟
  MIN_SEARCH_LENGTH: 2,
  STORAGE_KEYS: {
    RECENT_PROMPTS: 'recent_prompts',
    SETTINGS: 'promptmaster_settings',
    FEISHU_CONFIG: 'promptmaster_feishu_config'
  },
};

// 统一的消息通信函数
async function sendMessage(action, data = {}) {
  try {
    const response = await chrome.runtime.sendMessage({
      action,
      ...data
    });
    
    if (!response.success) {
      throw new Error(response.error || '请求失败');
    }
    
    return response.data;
  } catch (error) {
    console.error('消息发送失败:', error);
    throw error;
  }
}



// DOM 元素引用
const elements = {
  statusIndicator: null,
  statusDot: null,
  statusText: null,
  configNotice: null,
  configBtn: null,
  searchInput: null,
  searchBtn: null,
  openManagerBtn: null,
  createPromptBtn: null,
  captureBtn: null,
  promptsList: null,
  promptsLoading: null,
  totalPrompts: null,
  todayUsage: null,
  weekUsage: null,
  settingsBtn: null,
  helpBtn: null,
  refreshBtn: null,
  searchModal: null,
  searchResults: null,
  searchLoading: null,
  closeSearchBtn: null,
  createModal: null,
  closeCreateBtn: null,
  cancelCreateBtn: null,
  saveCreateBtn: null,
  createContent: null,
  createStatus: null,
};

// 状态管理
const state = {
  isConnected: false,
  prompts: [],
  expandedPromptId: null,
  stats: {
    total: 0,
    todayUsage: 0,
    weekUsage: 0,
  },
  searchResults: [],
  cache: new Map(),
};

// 搜索防抖定时器
let searchDebounceTimer = null;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  initializeElements();
  bindEvents();
  await initializeData();
});

// 初始化DOM元素引用
function initializeElements() {
  elements.statusIndicator = document.getElementById('statusIndicator');
  elements.statusDot = elements.statusIndicator?.querySelector('.status-dot');
  elements.statusText = elements.statusIndicator?.querySelector('.status-text');
  elements.configNotice = document.getElementById('configNotice');
  elements.configBtn = document.getElementById('configBtn');
  elements.searchInput = document.getElementById('searchInput');
  elements.searchBtn = document.getElementById('searchBtn');
  elements.openManagerBtn = document.getElementById('openManagerBtn');
  elements.createPromptBtn = document.getElementById('createPromptBtn');
  elements.captureBtn = document.getElementById('captureBtn');
  elements.promptsList = document.getElementById('promptsList');
  elements.promptsLoading = document.getElementById('promptsLoading');
  
  // 创建提示词相关元素
  elements.createModal = document.getElementById('createModal');
  elements.closeCreateBtn = document.getElementById('closeCreateBtn');
  elements.cancelCreateBtn = document.getElementById('cancelCreateBtn');
  elements.saveCreateBtn = document.getElementById('saveCreateBtn');
  elements.createContent = document.getElementById('createContent');
  elements.createStatus = document.getElementById('createStatus');
  elements.totalPrompts = document.getElementById('totalPrompts');
  elements.todayUsage = document.getElementById('todayUsage');
  elements.weekUsage = document.getElementById('weekUsage');
  elements.settingsBtn = document.getElementById('settingsBtn');
  elements.helpBtn = document.getElementById('helpBtn');
  elements.refreshBtn = document.getElementById('refreshBtn');
  elements.searchModal = document.getElementById('searchModal');
  elements.searchResults = document.getElementById('searchResults');
  elements.searchLoading = document.getElementById('searchLoading');
  elements.closeSearchBtn = document.getElementById('closeSearchBtn');
}

// 绑定事件监听器
function bindEvents() {
  // 搜索相关事件
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', handleSearchInput);
    elements.searchInput.addEventListener('keydown', handleSearchKeydown);
  }
  
  if (elements.searchBtn) {
    elements.searchBtn.addEventListener('click', handleSearchClick);
  }
  
  // 配置按钮
  if (elements.configBtn) {
    elements.configBtn.addEventListener('click', handleConfig);
  }
  
  // 快速操作按钮
  if (elements.openManagerBtn) {
    elements.openManagerBtn.addEventListener('click', handleOpenManager);
  }
  
  if (elements.createPromptBtn) {
    elements.createPromptBtn.addEventListener('click', handleCreatePrompt);
  }
  
  if (elements.captureBtn) {
    elements.captureBtn.addEventListener('click', handleCapture);
  }
  
  // 底部操作按钮
  if (elements.settingsBtn) {
    elements.settingsBtn.addEventListener('click', handleSettings);
  }
  
  if (elements.helpBtn) {
    elements.helpBtn.addEventListener('click', handleHelp);
  }
  
  if (elements.refreshBtn) {
    elements.refreshBtn.addEventListener('click', handleRefresh);
  }
  
  // 搜索弹窗
  if (elements.closeSearchBtn) {
    elements.closeSearchBtn.addEventListener('click', closeSearchModal);
  }
  
  if (elements.searchModal) {
    elements.searchModal.addEventListener('click', (e) => {
      if (e.target === elements.searchModal) {
        closeSearchModal();
      }
    });
  }
  
  // 创建提示词弹窗
  if (elements.closeCreateBtn) {
    elements.closeCreateBtn.addEventListener('click', closeCreateModal);
  }
  
  if (elements.cancelCreateBtn) {
    elements.cancelCreateBtn.addEventListener('click', closeCreateModal);
  }
  
  if (elements.saveCreateBtn) {
    elements.saveCreateBtn.addEventListener('click', handleSavePrompt);
  }

  if (elements.createModal) {
    elements.createModal.addEventListener('click', (e) => {
      if (e.target === elements.createModal) {
        closeCreateModal();
      }
    });
  }

  // 字符计数监听
  if (elements.createContent) {
    elements.createContent.addEventListener('input', updateCharCount);
  }

  // 快速模板按钮
  const templateButtons = document.querySelectorAll('.suggestion-btn');
  templateButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const templateType = btn.getAttribute('data-template');
      handleTemplateClick(templateType);
    });
  });
  
  // 键盘快捷键
  document.addEventListener('keydown', handleGlobalKeydown);
}

// 初始化数据
async function initializeData() {
  try {
    // 检查配置
    const hasConfig = await checkFeishuConfig();
    if (!hasConfig) {
      showConfigNotice();
      return;
    }
    
    // 隐藏配置提示
    hideConfigNotice();
    
    // 检查连接状态
    await checkConnection();
    
    // 并行加载数据
    await Promise.all([
      loadPrompts(),
      loadStats(),
      loadAutoRefreshStatus()
    ]);
  } catch (error) {
    console.error('初始化数据失败:', error);
    updateConnectionStatus(false, '连接失败');
  }
}

// 检查连接状态
async function checkConnection() {
  try {
    updateConnectionStatus(false, '连接中...');
    
    const response = await sendMessage('checkConnection');
    
    if (response && response.connected) {
      updateConnectionStatus(true, '已连接');
      state.isConnected = true;
    } else {
      updateConnectionStatus(false, '连接失败');
      state.isConnected = false;
    }
  } catch (error) {
    console.error('连接检查失败:', error);
    updateConnectionStatus(false, '连接失败');
    state.isConnected = false;
  }
}

// 更新连接状态显示
function updateConnectionStatus(connected, text) {
  if (elements.statusDot) {
    elements.statusDot.classList.toggle('disconnected', !connected);
  }
  
  if (elements.statusText) {
    elements.statusText.textContent = text;
  }
}

// 加载提示词列表
async function loadPrompts() {
  try {
    showPromptsLoading(true);
    
    // 尝试从缓存获取
    const cacheKey = 'prompts_list';
    const cached = getCachedData(cacheKey);
    if (cached) {
      console.log('从缓存加载提示词:', cached.length, '个');
      state.prompts = cached;
      renderPrompts();
      showPromptsLoading(false);
      return;
    }
    
    // 从API获取
    console.log('正在从API获取提示词列表...');
    const data = await sendMessage('getPrompts');
    console.log('API返回的数据:', data);
    
    // 检查数据结构
    if (Array.isArray(data)) {
      state.prompts = data;
      console.log('成功加载提示词:', data.length, '个');
    } else if (data && Array.isArray(data.items)) {
      // 如果返回的是分页数据结构
      state.prompts = data.items;
      console.log('成功加载提示词(分页):', data.items.length, '个');
    } else {
      console.warn('API返回的数据格式不正确:', data);
      state.prompts = [];
    }
    
    setCachedData(cacheKey, state.prompts);
    renderPrompts();
  } catch (error) {
    console.error('加载提示词列表失败:', error);
    state.prompts = [];
    renderPrompts();
  } finally {
    showPromptsLoading(false);
  }
}

// 加载统计数据
async function loadStats() {
  try {
    // 尝试从缓存获取
    const cacheKey = 'stats';
    const cached = getCachedData(cacheKey);
    if (cached) {
      state.stats = cached;
      renderStats();
      return;
    }
    
    // 从API获取
    const data = await sendMessage('getStats');
    state.stats = {
      total: data?.total || 0,
      todayUsage: data?.todayUsage || 0,
      weekUsage: data?.weekUsage || 0,
    };
    setCachedData(cacheKey, state.stats);
    renderStats();
  } catch (error) {
    console.error('加载统计数据失败:', error);
    renderStats();
  }
}

// 加载自动刷新状态
async function loadAutoRefreshStatus() {
  try {
    const response = await sendMessage('getAutoRefreshStatus');
    if (response) {
      // 如果有最后刷新时间，显示在状态栏中
      if (response.lastRefreshTime) {
        const statusElement = document.getElementById('lastRefreshTime');
        if (statusElement) {
          statusElement.textContent = `最后刷新: ${response.lastRefreshTime}`;
          statusElement.style.display = 'block';
        }
      }
      
      // 显示自动刷新状态
      console.log('自动刷新状态:', {
        enabled: response.enabled,
        interval: response.interval,
        lastRefreshTime: response.lastRefreshTime
      });
    }
  } catch (error) {
    console.error('加载自动刷新状态失败:', error);
  }
}

// 渲染提示词列表
function renderPrompts() {
  console.log('开始渲染提示词列表, 数量:', state.prompts.length);
  console.log('promptsList元素:', elements.promptsList);
  
  if (!elements.promptsList) {
    console.error('promptsList元素未找到!');
    return;
  }
  
  if (state.prompts.length === 0) {
    console.log('显示空状态');
    elements.promptsList.innerHTML = `
      <div class="empty-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>暂无提示词</p>
      </div>
    `;
    return;
  }
  
  console.log('生成HTML内容...');
  const html = state.prompts.map(prompt => {
    console.log('处理提示词:', prompt.title || prompt.id);
    return createPromptBlockHTML(prompt);
  }).join('');
  
  console.log('设置innerHTML, HTML长度:', html.length);
  elements.promptsList.innerHTML = html;
  
  // 绑定点击事件
  bindPromptBlockEvents(elements.promptsList);
  console.log('提示词列表渲染完成');
}

// 渲染统计数据
function renderStats() {
  if (elements.totalPrompts) {
    elements.totalPrompts.textContent = state.stats.total.toLocaleString();
  }
  
  if (elements.todayUsage) {
    elements.todayUsage.textContent = state.stats.todayUsage.toLocaleString();
  }
  
  if (elements.weekUsage) {
    elements.weekUsage.textContent = state.stats.weekUsage.toLocaleString();
  }
}

// 创建提示词小方块HTML
function createPromptBlockHTML(prompt) {
  const category = prompt.category || '未分类';
  const alias = prompt.alias || '';
  const tags = prompt.tags || [];
  
  // 构建小方块展示内容
  const blocks = [];
  
  // 标题块
  if (prompt.title) {
    blocks.push(`<span class="prompt-block title-block">${escapeHtml(prompt.title)}</span>`);
  }
  
  // 别名块
  if (alias) {
    blocks.push(`<span class="prompt-block alias-block">${escapeHtml(alias)}</span>`);
  }
  
  // 分类块
  blocks.push(`<span class="prompt-block category-block">${escapeHtml(category)}</span>`);
  
  // 标签块
  if (tags.length > 0) {
    const displayTags = tags.slice(0, 3).map(tag => escapeHtml(tag)).join(', ');
    const tagText = tags.length > 3 ? `${displayTags}...` : displayTags;
    blocks.push(`<span class="prompt-block tags-block">${tagText}</span>`);
  }
  
  const blocksHTML = blocks.join('<span class="block-separator">\\</span>');
  const isExpanded = state.expandedPromptId === prompt.id;
  
  return `
    <div class="prompt-block-item ${isExpanded ? 'expanded' : ''}" data-id="${prompt.id}">
      <div class="prompt-blocks-display" data-action="toggle">
        ${blocksHTML}
      </div>
      ${isExpanded ? `
        <div class="prompt-detail-content">
          <div class="prompt-full-info">
            <div class="prompt-title">${escapeHtml(prompt.title || '')}</div>
            ${prompt.description ? `<div class="prompt-description">${escapeHtml(prompt.description)}</div>` : ''}
            <div class="prompt-content">${escapeHtml(prompt.content || '').replace(/\n/g, '<br>')}</div>
            <div class="prompt-meta">
              <span class="meta-item">分类: ${escapeHtml(category)}</span>
              ${alias ? `<span class="meta-item">别名: ${escapeHtml(alias)}</span>` : ''}
              ${tags.length > 0 ? `<span class="meta-item">标签: ${tags.map(tag => escapeHtml(tag)).join(', ')}</span>` : ''}
              <span class="meta-item">更新: ${formatDate(prompt.updatedAt)}</span>
            </div>
          </div>
          <div class="prompt-actions">
            <button class="action-btn" data-action="copy" title="复制内容">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              复制
            </button>
            <button class="action-btn primary" data-action="use" title="使用提示词">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14m-7-7l7 7-7 7"></path>
              </svg>
              使用
            </button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}


// 绑定提示词小方块事件
function bindPromptBlockEvents(container) {
  // 移除之前的事件监听器（如果存在）
  if (container._promptClickHandler) {
    container.removeEventListener('click', container._promptClickHandler);
  }
  
  // 创建新的事件处理函数
  const clickHandler = async (e) => {
    console.log('点击事件触发:', e.target);
    const promptItem = e.target.closest('.prompt-block-item');
    if (!promptItem) {
      console.log('未找到prompt-block-item');
      return;
    }
    
    const promptId = promptItem.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    console.log('点击的promptId:', promptId, 'action:', action);
    
    if (action === 'toggle') {
      console.log('执行toggle操作');
      // 切换展开/收起状态
      togglePromptExpansion(promptId);
    } else if (action === 'copy') {
      console.log('执行copy操作');
      await handleCopyPrompt(promptId);
    } else if (action === 'use') {
      console.log('执行use操作');
      await handleUsePrompt(promptId);
    } else {
      console.log('未识别的action或无action，默认执行toggle');
      // 如果没有明确的action，默认执行toggle
      togglePromptExpansion(promptId);
    }
  };
  
  // 绑定新的事件监听器
  container.addEventListener('click', clickHandler);
  // 保存引用以便后续移除
  container._promptClickHandler = clickHandler;
}

// 切换提示词展开状态
function togglePromptExpansion(promptId) {
  console.log('togglePromptExpansion调用, promptId:', promptId, '当前展开的ID:', state.expandedPromptId);
  
  if (state.expandedPromptId === promptId) {
    // 如果当前项已展开，则收起
    console.log('收起当前展开的项');
    state.expandedPromptId = null;
  } else {
    // 展开新项，收起其他项
    console.log('展开新项:', promptId);
    state.expandedPromptId = promptId;
  }
  
  console.log('新的展开状态:', state.expandedPromptId);
  // 重新渲染
  renderPrompts();
}

// 显示提示词详情
async function showPromptDetail(promptId) {
  try {
    // 获取提示词详情
    const prompt = await apiCall(`${CONFIG.API_BASE_URL}/prompts/${promptId}`);
    
    if (!prompt) {
      showToast('获取提示词详情失败', 'error');
      return;
    }
    
    // 创建详情弹窗
    const modal = document.createElement('div');
    modal.className = 'prompt-detail-modal';
    modal.innerHTML = `
      <div class="modal-overlay" data-action="close-modal"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(prompt.title)}</h3>
          <button class="modal-close" data-action="close-modal">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="prompt-detail-info">
            ${prompt.alias ? `<div class="detail-item"><label>别名:</label><span>${escapeHtml(prompt.alias)}</span></div>` : ''}
            <div class="detail-item"><label>分类:</label><span>${escapeHtml(prompt.category || '未分类')}</span></div>
            ${prompt.tags && prompt.tags.length > 0 ? `<div class="detail-item"><label>标签:</label><div class="tags-list">${prompt.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div></div>` : ''}
            <div class="detail-item"><label>更新时间:</label><span>${formatDate(prompt.updatedAt)}</span></div>
          </div>
          <div class="prompt-content-section">
            <label>提示词内容:</label>
            <div class="prompt-content-text">${escapeHtml(prompt.content || '').replace(/\n/g, '<br>')}</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="close-modal">关闭</button>
          <button class="btn btn-primary" data-action="copy-content" data-content="${escapeHtml(prompt.content || '')}">复制内容</button>
          <button class="btn btn-primary" data-action="use-prompt" data-id="${prompt.id}">使用提示词</button>
        </div>
      </div>
    `;
    
    // 添加到页面
    document.body.appendChild(modal);
    
    // 绑定事件
    modal.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      
      if (action === 'close-modal') {
        document.body.removeChild(modal);
      } else if (action === 'copy-content') {
        const content = e.target.dataset.content;
        await copyToClipboard(content);
        showToast('内容已复制到剪贴板');
      } else if (action === 'use-prompt') {
        const id = e.target.dataset.id;
        document.body.removeChild(modal);
        await handleUsePrompt(id);
      }
    });
    
    // 记录查看详情的使用
    recordPromptUsage(promptId, 'view');
    
  } catch (error) {
    console.error('显示提示词详情失败:', error);
    showToast('获取提示词详情失败', 'error');
  }
}

// 处理搜索输入
function handleSearchInput(e) {
  const query = e.target.value.trim();
  
  // 清除之前的定时器
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  
  // 设置新的定时器
  searchDebounceTimer = setTimeout(() => {
    if (query.length >= 2) {
      performSearch(query);
    }
  }, CONFIG.SEARCH_DEBOUNCE_DELAY);
}

// 处理搜索键盘事件
function handleSearchKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const query = e.target.value.trim();
    if (query) {
      performSearch(query);
    }
  }
}

// 处理搜索按钮点击
function handleSearchClick() {
  const query = elements.searchInput?.value.trim();
  if (query) {
    performSearch(query);
  }
}

// 执行搜索
async function performSearch(query) {
  try {
    showSearchModal();
    showSearchLoading(true);
    
    const data = await sendMessage('searchPrompts', { query });
    
    // 处理API返回的数据结构
    if (Array.isArray(data)) {
      state.searchResults = data;
    } else if (data && Array.isArray(data.items)) {
      // 如果返回的是分页数据结构
      state.searchResults = data.items;
      console.log('搜索结果分页信息:', data.pagination);
    } else {
      console.warn('搜索API返回的数据格式不正确:', data);
      state.searchResults = [];
    }
    
    console.log('搜索完成，找到', state.searchResults.length, '个结果');
    renderSearchResults();
  } catch (error) {
    console.error('搜索失败:', error);
    showSearchError('搜索失败，请稍后重试');
  } finally {
    showSearchLoading(false);
  }
}

// 渲染搜索结果
function renderSearchResults() {
  if (!elements.searchResults) return;
  
  if (state.searchResults.length === 0) {
    elements.searchResults.innerHTML = `
      <div class="empty-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <p>未找到相关提示词</p>
      </div>
    `;
    return;
  }
  
  const html = state.searchResults.map(prompt => createPromptItemHTML(prompt)).join('');
  elements.searchResults.innerHTML = html;
  
  // 绑定点击事件
  bindPromptItemEvents(elements.searchResults);
}

// 显示搜索加载状态
function showSearchLoading(show) {
  if (elements.searchLoading) {
    elements.searchLoading.style.display = show ? 'flex' : 'none';
  }
}

// 显示搜索错误
function showSearchError(message) {
  if (elements.searchResults) {
    elements.searchResults.innerHTML = `
      <div class="empty-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }
}

// 显示/隐藏搜索弹窗
function showSearchModal() {
  if (elements.searchModal) {
    elements.searchModal.classList.add('show');
  }
}

function closeSearchModal() {
  if (elements.searchModal) {
    elements.searchModal.classList.remove('show');
  }
}

// 显示提示词加载状态
function showPromptsLoading(show) {
  if (elements.promptsLoading) {
    elements.promptsLoading.style.display = show ? 'flex' : 'none';
  }
}

// 处理复制提示词
async function handleCopyPrompt(promptId) {
  try {
    const prompt = await getPromptById(promptId);
    if (prompt) {
      await navigator.clipboard.writeText(prompt.content);
      showToast('已复制到剪贴板');
      
      // 记录使用
      recordPromptUsage(promptId);
    }
  } catch (error) {
    console.error('复制失败:', error);
    showToast('复制失败');
  }
}

// 处理使用提示词
async function handleUsePrompt(promptId) {
  try {
    const prompt = await getPromptById(promptId);
    if (prompt) {
      // 发送消息到content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'INSERT_PROMPT',
          data: {
            content: prompt.content,
            variables: prompt.variables || [],
          },
        });
        
        // 记录使用
        recordPromptUsage(promptId);
        
        // 关闭弹窗
        window.close();
      }
    }
  } catch (error) {
    console.error('使用提示词失败:', error);
    showToast('使用失败');
  }
}

// 获取提示词详情
async function getPromptById(promptId) {
  try {
    const data = await sendMessage('getPromptById', { id: promptId });
    return data;
  } catch (error) {
    console.error('获取提示词失败:', error);
    return null;
  }
}

// 记录提示词使用
async function recordPromptUsage(promptId) {
  try {
    await sendMessage('recordUsage', {
      promptId,
      timestamp: new Date().toISOString(),
      source: 'extension'
    });
  } catch (error) {
    console.error('记录使用失败:', error);
  }
}

// 处理打开管理器
function handleOpenManager() {
  chrome.tabs.create({ url: 'http://localhost:3002' });
}

// 处理内容捕获
async function handleCapture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'CAPTURE_CONTENT',
      });
      
      showToast('内容捕获已启动');
      window.close();
    }
  } catch (error) {
    console.error('内容捕获失败:', error);
    showToast('捕获失败');
  }
}

// 处理配置
function handleConfig() {
  chrome.runtime.openOptionsPage();
}

// 处理设置
function handleSettings() {
  chrome.runtime.openOptionsPage();
}

// 处理帮助
function handleHelp() {
  chrome.tabs.create({ url: 'https://github.com/your-repo/help' });
}

// 处理刷新
async function handleRefresh() {
  try {
    // 清除缓存
    state.cache.clear();
    state.expandedPromptId = null;
    
    // 发送手动刷新请求
    await sendMessage('manualRefresh');
    
    // 重新加载数据
    await initializeData();
    
    showToast('数据已刷新');
  } catch (error) {
    console.error('刷新数据失败:', error);
    showToast('刷新失败');
  }
}

// 处理全局键盘事件
function handleGlobalKeydown(e) {
  // Escape 关闭搜索弹窗
  if (e.key === 'Escape') {
    closeSearchModal();
  }
  
  // Ctrl/Cmd + K 聚焦搜索框
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    elements.searchInput?.focus();
  }
}

// 缓存管理
function getCachedData(key) {
  const cached = state.cache.get(key);
  if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
    return cached.data;
  }
  return null;
}

function setCachedData(key, data) {
  state.cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

// 工具函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) { // 1分钟内
    return '刚刚';
  } else if (diff < 3600000) { // 1小时内
    return `${Math.floor(diff / 60000)}分钟前`;
  } else if (diff < 86400000) { // 1天内
    return `${Math.floor(diff / 3600000)}小时前`;
  } else if (diff < 604800000) { // 1周内
    return `${Math.floor(diff / 86400000)}天前`;
  } else {
    return date.toLocaleDateString();
  }
}

// 检查飞书配置
async function checkFeishuConfig() {
  try {
    const result = await chrome.storage.sync.get(['promptmaster_feishu_config']);
    const config = result.promptmaster_feishu_config;
    
    return config && config.appId && config.appSecret && config.bitableAppToken && config.bitableTableId;
  } catch (error) {
    console.error('检查配置失败:', error);
    return false;
  }
}

// 显示配置提示
function showConfigNotice() {
  if (elements.configNotice) {
    elements.configNotice.style.display = 'block';
  }
}

// 隐藏配置提示
function hideConfigNotice() {
  if (elements.configNotice) {
    elements.configNotice.style.display = 'none';
  }
}

function showToast(message) {
  // 简单的toast实现
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;
  
  document.body.appendChild(toast);
  
  // 显示动画
  setTimeout(() => {
    toast.style.opacity = '1';
  }, 10);
  
  // 自动隐藏
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 2000);
}

// ==================== 创建提示词功能 ====================

// 处理创建提示词按钮点击
function handleCreatePrompt() {
  if (!state.isConnected) {
    showToast('请先配置飞书API参数');
    return;
  }
  
  showCreateModal();
}

// 显示创建提示词模态框
function showCreateModal() {
  if (elements.createModal) {
    elements.createModal.style.display = 'flex';

    // 清空表单
    if (elements.createContent) elements.createContent.value = '';

    // 隐藏状态信息
    if (elements.createStatus) {
      elements.createStatus.style.display = 'none';
    }

    // 重置字符计数
    updateCharCount();

    // 聚焦到内容输入框
    if (elements.createContent) {
      setTimeout(() => elements.createContent.focus(), 100);
    }
  }
}

// 更新字符计数
function updateCharCount() {
  if (elements.createContent && document.getElementById('charCount')) {
    const count = elements.createContent.value.length;
    document.getElementById('charCount').textContent = count;

    // 根据字符数改变颜色
    const counterElement = document.getElementById('charCount');
    if (count > 1800) {
      counterElement.style.color = '#ef4444';
    } else if (count > 1500) {
      counterElement.style.color = '#f59e0b';
    } else {
      counterElement.style.color = '#3b82f6';
    }
  }
}

// 处理快速模板点击
function handleTemplateClick(templateType) {
  const templates = {
    writing: `你是一个专业的文案撰写助手，请帮我写一段关于产品推广的文案。

要求：
1. 语言简洁明了，突出产品特点
2. 具有吸引力和说服力
3. 适合在社交媒体上传播

请开始写作：`,
    coding: `你是一个经验丰富的编程助手，请帮我优化以下代码：

[请在这里粘贴你的代码]

要求：
1. 提高代码性能和可读性
2. 添加必要的注释
3. 遵循最佳实践

请开始优化：`,
    analysis: `你是一个数据分析专家，请帮我分析以下数据：

[请在这里描述你的数据]

要求：
1. 找出关键趋势和模式
2. 提供数据可视化建议
3. 给出可行的改进建议

请开始分析：`
  };

  if (templates[templateType] && elements.createContent) {
    elements.createContent.value = templates[templateType];
    updateCharCount();
  }
}

// 关闭创建提示词模态框
function closeCreateModal() {
  if (elements.createModal) {
    elements.createModal.style.display = 'none';
  }
}

// 处理保存提示词
async function handleSavePrompt() {
  const content = elements.createContent?.value.trim();

  // 验证必填字段
  if (!content) {
    showCreateStatus('请输入内容', 'error');
    elements.createContent?.focus();
    return;
  }
  
  // 禁用保存按钮
  if (elements.saveCreateBtn) {
    elements.saveCreateBtn.disabled = true;
    elements.saveCreateBtn.textContent = '保存中...';
  }
  
  try {
    // 准备提示词数据 - 只设置必要字段，其他保持默认
    const promptData = {
      title: content.substring(0, 50) + (content.length > 50 ? '...' : ''), // 取前50个字符作为标题
      content: content,
      category: '快速添加'
    };
    
    console.log('准备保存提示词:', promptData);
    
    // 发送到background script
    const result = await sendMessage('createPrompt', { promptData });
    
    showCreateStatus('提示词保存成功！', 'success');
    
    // 刷新提示词列表
    await loadPrompts(true);
    
    // 延迟关闭模态框
    setTimeout(() => {
      closeCreateModal();
    }, 1500);
    
  } catch (error) {
    console.error('保存提示词失败:', error);
    showCreateStatus(`保存失败: ${error.message}`, 'error');
  } finally {
    // 恢复保存按钮
    if (elements.saveCreateBtn) {
      elements.saveCreateBtn.disabled = false;
      elements.saveCreateBtn.textContent = '保存';
    }
  }
}

// 显示创建状态信息
function showCreateStatus(message, type) {
  if (!elements.createStatus) return;
  
  elements.createStatus.style.display = 'block';
  elements.createStatus.textContent = message;
  
  // 重置样式
  elements.createStatus.className = 'create-status';
  
  if (type === 'success') {
    elements.createStatus.style.background = '#d4edda';
    elements.createStatus.style.color = '#155724';
    elements.createStatus.style.border = '1px solid #c3e6cb';
  } else if (type === 'error') {
    elements.createStatus.style.background = '#f8d7da';
    elements.createStatus.style.color = '#721c24';
    elements.createStatus.style.border = '1px solid #f5c6cb';
  }
}