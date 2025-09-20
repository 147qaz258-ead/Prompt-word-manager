// 提示词管理器 Chrome 插件 - Content Script
// 负责页面内容监听、快捷指令触发和提示词选择器

// ==================== 配置常量 ====================
const CONFIG = {
  // 触发字符配置
  TRIGGER_CHARS: ['/', '@'],
  TRIGGER_SEQUENCES: ['//', '@@'],
  
  // 搜索配置
  MIN_SEARCH_LENGTH: 1,
  SEARCH_DEBOUNCE_DELAY: 200,
  MAX_RESULTS: 10,
  
  // 选择器配置
  SELECTOR_ID: 'prompt-manager-selector',
  SELECTOR_CLASS: 'promptmaster-selector',
  RESULT_ITEM_CLASS: 'promptmaster-result-item',
  SELECTED_CLASS: 'selected',
  
  // 键盘导航
  KEYS: {
    ESCAPE: 'Escape',
    ENTER: 'Enter',
    ARROW_UP: 'ArrowUp',
    ARROW_DOWN: 'ArrowDown',
    TAB: 'Tab'
  },
  
  // 定位配置
  SELECTOR_OFFSET: { x: 0, y: 5 },
  VIEWPORT_MARGIN: 20
};

// ==================== 状态管理 ====================
let state = {
  isActive: false,
  currentElement: null,
  triggerPosition: null,
  searchQuery: '',
  results: [],
  selectedIndex: -1,
  selector: null,
  searchTimeout: null,
  lastTriggerChar: null
};

// ==================== 工具函数 ====================

/**
 * 判断元素是否可编辑
 */
function isEditableElement(element) {
  if (!element) return false;
  
  const tagName = element.tagName.toLowerCase();
  
  // 输入框和文本域
  if (tagName === 'input') {
    const type = element.type.toLowerCase();
    return ['text', 'search', 'url', 'email', 'password', 'tel', 'number'].includes(type);
  }
  
  if (tagName === 'textarea') {
    return true;
  }
  
  // 可编辑的div
  if (element.contentEditable === 'true') {
    return true;
  }
  
  // 检查是否在可编辑容器内
  let parent = element.parentElement;
  while (parent) {
    if (parent.contentEditable === 'true') {
      return true;
    }
    parent = parent.parentElement;
  }
  
  // 特殊处理：检查常见聊天框选择器
  const chatSelectors = [
    '[contenteditable="true"]',
    '[role="textbox"]',
    '.chat-input',
    '.message-input',
    '.input-box',
    '[data-testid*="input"]',
    '[data-testid*="textbox"]',
    '[aria-label*="输入"]',
    '[aria-label*="input"]',
    '[aria-label*="message"]',
    '[placeholder*="输入"]',
    '[placeholder*="input"]',
    '[placeholder*="message"]'
  ];
  
  for (const selector of chatSelectors) {
    if (element.matches && element.matches(selector)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 获取光标位置信息
 */
function getCursorPosition(element) {
  try {
    if (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea') {
      return {
        start: element.selectionStart,
        end: element.selectionEnd,
        text: element.value
      };
    }
    
    if (element.contentEditable === 'true') {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const textContent = element.textContent || '';
        
        // 创建一个临时range来计算偏移量
        const tempRange = document.createRange();
        tempRange.setStart(element, 0);
        tempRange.setEnd(range.startContainer, range.startOffset);
        
        const start = tempRange.toString().length;
        const end = start + range.toString().length;
        
        return {
          start: start,
          end: end,
          text: textContent,
          range: range
        };
      }
    }
  } catch (error) {
    console.warn('获取光标位置失败:', error);
  }
  
  return null;
}

/**
 * 查找触发字符位置
 */
function findTriggerPosition(text, cursorPos) {
  if (!text || cursorPos < 0) return null;
  
  // 从光标位置向前查找触发序列
  for (let i = Math.min(cursorPos, text.length - 1); i >= 0; i--) {
    // 检查双字符触发序列
    for (const sequence of CONFIG.TRIGGER_SEQUENCES) {
      if (i >= sequence.length - 1) {
        const substr = text.substring(i - sequence.length + 1, i + 1);
        if (substr === sequence) {
          // 确保触发序列前面是空格、换行或字符串开始
          const prevChar = i - sequence.length >= 0 ? text[i - sequence.length] : '';
          if (!prevChar || /\s/.test(prevChar)) {
            return {
              position: i - sequence.length + 1,
              sequence: sequence,
              char: sequence[0]
            };
          }
        }
      }
    }
  }
  
  return null;
}

/**
 * 提取搜索查询
 */
function extractSearchQuery(text, triggerPos, cursorPos) {
  if (!triggerPos || cursorPos <= triggerPos.position) return '';
  
  const start = triggerPos.position + triggerPos.sequence.length;
  const query = text.substring(start, cursorPos).trim();
  
  return query;
}

/**
 * 防抖搜索
 */
function debounceSearch(query, delay = CONFIG.SEARCH_DEBOUNCE_DELAY) {
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
  }
  
  state.searchTimeout = setTimeout(() => {
    performSearch(query);
  }, delay);
}

/**
 * 执行搜索
 */
async function performSearch(query) {
  try {
    if (query.length < CONFIG.MIN_SEARCH_LENGTH) {
      state.results = [];
      updateSelector();
      return;
    }
    
    // 显示加载状态
    showLoadingState();
    
    // 发送搜索请求到background script
    const response = await chrome.runtime.sendMessage({
      type: 'SEARCH_PROMPTS',
      query: query,
      limit: CONFIG.MAX_RESULTS
    });
    
    if (response && response.success) {
      state.results = response.data || [];
      state.selectedIndex = state.results.length > 0 ? 0 : -1;
    } else {
      state.results = [];
      state.selectedIndex = -1;
      console.warn('搜索失败:', response?.error);
    }
    
    updateSelector();
    
  } catch (error) {
    console.error('搜索出错:', error);
    state.results = [];
    state.selectedIndex = -1;
    updateSelector();
  }
}

/**
 * 显示加载状态
 */
function showLoadingState() {
  if (!state.selector) return;
  
  const resultsList = state.selector.querySelector('.promptmaster-results');
  if (resultsList) {
    resultsList.innerHTML = '<div class="promptmaster-loading">搜索中...</div>';
  }
}

/**
 * 创建选择器元素
 */
function createSelector() {
  const selector = document.createElement('div');
  selector.id = CONFIG.SELECTOR_ID;
  selector.className = CONFIG.SELECTOR_CLASS;
  
  selector.innerHTML = `
    <div class="promptmaster-selector-header">
      <span class="promptmaster-trigger-hint">输入关键词搜索提示词</span>
      <span class="promptmaster-keyboard-hint">↑↓ 选择 • Enter 确认 • Esc 取消</span>
    </div>
    <div class="promptmaster-results"></div>
    <div class="promptmaster-selector-footer">
      <span class="promptmaster-results-count">0 个结果</span>
    </div>
  `;
  
  // 防止选择器内的事件冒泡
  selector.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  
  selector.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  
  return selector;
}

/**
 * 定位选择器
 */
function positionSelector() {
  if (!state.selector || !state.currentElement) return;
  
  try {
    let rect;
    
    if (state.currentElement.tagName.toLowerCase() === 'input' || 
        state.currentElement.tagName.toLowerCase() === 'textarea') {
      // 对于input和textarea，使用元素的边界
      rect = state.currentElement.getBoundingClientRect();
    } else {
      // 对于contentEditable元素，尝试获取光标位置
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        rect = range.getBoundingClientRect();
      } else {
        rect = state.currentElement.getBoundingClientRect();
      }
    }
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const selectorRect = state.selector.getBoundingClientRect();
    
    let left = rect.left + CONFIG.SELECTOR_OFFSET.x;
    let top = rect.bottom + CONFIG.SELECTOR_OFFSET.y;
    
    // 水平边界检查
    if (left + selectorRect.width > viewportWidth - CONFIG.VIEWPORT_MARGIN) {
      left = viewportWidth - selectorRect.width - CONFIG.VIEWPORT_MARGIN;
    }
    if (left < CONFIG.VIEWPORT_MARGIN) {
      left = CONFIG.VIEWPORT_MARGIN;
    }
    
    // 垂直边界检查
    if (top + selectorRect.height > viewportHeight - CONFIG.VIEWPORT_MARGIN) {
      // 如果下方空间不够，显示在输入框上方
      top = rect.top - selectorRect.height - CONFIG.SELECTOR_OFFSET.y;
      if (top < CONFIG.VIEWPORT_MARGIN) {
        // 如果上方也不够，显示在视口中央
        top = (viewportHeight - selectorRect.height) / 2;
      }
    }
    
    state.selector.style.left = `${left + window.scrollX}px`;
    state.selector.style.top = `${top + window.scrollY}px`;
    
  } catch (error) {
    console.warn('定位选择器失败:', error);
  }
}

/**
 * 更新选择器内容
 */
function updateSelector() {
  if (!state.selector) return;
  
  const resultsList = state.selector.querySelector('.promptmaster-results');
  const resultsCount = state.selector.querySelector('.promptmaster-results-count');
  
  if (!resultsList || !resultsCount) return;
  
  // 更新结果计数
  resultsCount.textContent = `${state.results.length} 个结果`;
  
  // 清空现有结果
  resultsList.innerHTML = '';
  
  if (state.results.length === 0) {
    if (state.searchQuery.length >= CONFIG.MIN_SEARCH_LENGTH) {
      resultsList.innerHTML = '<div class="promptmaster-empty">未找到匹配的提示词</div>';
    } else {
      resultsList.innerHTML = '<div class="promptmaster-empty">输入关键词开始搜索</div>';
    }
    return;
  }
  
  // 渲染搜索结果
  state.results.forEach((result, index) => {
    const item = document.createElement('div');
    item.className = `${CONFIG.RESULT_ITEM_CLASS} ${index === state.selectedIndex ? CONFIG.SELECTED_CLASS : ''}`;
    item.dataset.index = index;
    
    // 高亮搜索关键词
    const highlightedTitle = highlightSearchTerm(result.title, state.searchQuery);
    const highlightedAlias = result.alias ? highlightSearchTerm(result.alias, state.searchQuery) : '';
    
    // 构建小方块展示内容
    const blocks = [];
    
    // 标题块
    if (result.title) {
      blocks.push(`<span class="promptmaster-block promptmaster-block-title">${highlightedTitle}</span>`);
    }
    
    // 别名块
    if (result.alias) {
      blocks.push(`<span class="promptmaster-block promptmaster-block-alias">${highlightedAlias}</span>`);
    }
    
    // 分类块
    if (result.category) {
      blocks.push(`<span class="promptmaster-block promptmaster-block-category">${result.category}</span>`);
    }
    
    // 标签块
    if (result.tags && result.tags.length > 0) {
      result.tags.forEach(tag => {
        blocks.push(`<span class="promptmaster-block promptmaster-block-tag">${tag}</span>`);
      });
    }
    
    item.innerHTML = `
      <div class="promptmaster-result-blocks">
        ${blocks.join(' \\\\ ')}
      </div>
      <div class="promptmaster-result-usage">
        <span class="promptmaster-usage-count">使用 ${result.usageCount || 0} 次</span>
      </div>
      <div class="promptmaster-result-preview" style="display: none;">
        <div class="promptmaster-preview-content">${result.content}</div>
        <div class="promptmaster-preview-description">${result.description || ''}</div>
      </div>
    `;
    
    // 添加点击事件 - 展开/收起详情
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const preview = item.querySelector('.promptmaster-result-preview');
      const isExpanded = preview.style.display !== 'none';
      
      if (isExpanded) {
        // 收起详情，插入提示词
        preview.style.display = 'none';
        item.classList.remove('expanded');
        selectResult(index);
      } else {
        // 展开详情
        // 先收起其他展开的项
        const allItems = resultsList.querySelectorAll('.promptmaster-result-item');
        allItems.forEach(otherItem => {
          const otherPreview = otherItem.querySelector('.promptmaster-result-preview');
          otherPreview.style.display = 'none';
          otherItem.classList.remove('expanded');
        });
        
        // 展开当前项
        preview.style.display = 'block';
        item.classList.add('expanded');
      }
    });
    
    // 添加鼠标悬停事件
    item.addEventListener('mouseenter', () => {
      state.selectedIndex = index;
      updateSelection();
    });
    
    resultsList.appendChild(item);
  });
  
  // 重新定位选择器
  setTimeout(() => positionSelector(), 0);
}

/**
 * 高亮搜索关键词
 */
function highlightSearchTerm(text, searchTerm) {
  if (!text || !searchTerm) return text;
  
  const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 截断文本
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * 更新选择状态
 */
function updateSelection() {
  if (!state.selector) return;
  
  const items = state.selector.querySelectorAll(`.${CONFIG.RESULT_ITEM_CLASS}`);
  items.forEach((item, index) => {
    if (index === state.selectedIndex) {
      item.classList.add(CONFIG.SELECTED_CLASS);
      // 确保选中项在视野内
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove(CONFIG.SELECTED_CLASS);
    }
  });
}

/**
 * 显示选择器
 */
function showSelector() {
  if (state.selector) {
    hideSelector();
  }
  
  state.selector = createSelector();
  document.body.appendChild(state.selector);
  
  // 初始定位
  positionSelector();
  
  // 初始搜索（空查询显示提示）
  updateSelector();
  
  state.isActive = true;
}

/**
 * 隐藏选择器
 */
function hideSelector() {
  if (state.selector) {
    state.selector.remove();
    state.selector = null;
  }
  
  // 清理状态
  state.isActive = false;
  state.currentElement = null;
  state.triggerPosition = null;
  state.searchQuery = '';
  state.results = [];
  state.selectedIndex = -1;
  state.lastTriggerChar = null;
  
  // 清理定时器
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = null;
  }
}

/**
 * 选择结果
 */
function selectResult(index) {
  if (index < 0 || index >= state.results.length) return;
  
  const result = state.results[index];
  insertPrompt(result);
  hideSelector();
}

/**
 * 插入提示词
 */
function insertPrompt(prompt) {
  if (!state.currentElement || !state.triggerPosition) return;
  
  try {
    const cursorInfo = getCursorPosition(state.currentElement);
    if (!cursorInfo) return;
    
    const { text } = cursorInfo;
    const triggerStart = state.triggerPosition.position;
    const triggerEnd = triggerStart + state.triggerPosition.sequence.length + state.searchQuery.length;
    
    // 构建新文本
    const beforeTrigger = text.substring(0, triggerStart);
    const afterTrigger = text.substring(triggerEnd);
    const newText = beforeTrigger + prompt.content + afterTrigger;
    
    // 插入文本
    if (state.currentElement.tagName.toLowerCase() === 'input' || 
        state.currentElement.tagName.toLowerCase() === 'textarea') {
      // 对于input和textarea
      state.currentElement.value = newText;
      const newCursorPos = triggerStart + prompt.content.length;
      state.currentElement.setSelectionRange(newCursorPos, newCursorPos);
      
      // 触发input事件
      state.currentElement.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (state.currentElement.contentEditable === 'true') {
      // 对于contentEditable元素
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // 创建新的文本节点
        const textNode = document.createTextNode(prompt.content);
        
        // 删除触发序列和搜索查询
        const deleteRange = document.createRange();
        deleteRange.setStart(range.startContainer, Math.max(0, range.startOffset - state.triggerPosition.sequence.length - state.searchQuery.length));
        deleteRange.setEnd(range.startContainer, range.startOffset);
        deleteRange.deleteContents();
        
        // 插入新文本
        deleteRange.insertNode(textNode);
        
        // 设置光标位置
        const newRange = document.createRange();
        newRange.setStartAfter(textNode);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        
        // 触发input事件
        state.currentElement.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    
    // 记录使用
    recordPromptUsage(prompt.id);
    
  } catch (error) {
    console.error('插入提示词失败:', error);
  }
}

/**
 * 记录提示词使用
 */
async function recordPromptUsage(promptId) {
  try {
    await chrome.runtime.sendMessage({
      type: 'RECORD_USAGE',
      promptId: promptId
    });
  } catch (error) {
    console.warn('记录使用失败:', error);
  }
}

// ==================== 事件监听 ====================

/**
 * 输入事件处理
 */
function handleInput(event) {
  const element = event.target;
  
  // 调试信息
  console.log('📝 输入事件触发:', {
    tagName: element.tagName,
    type: element.type,
    contentEditable: element.contentEditable,
    className: element.className,
    id: element.id
  });
  
  if (!isEditableElement(element)) {
    console.log('❌ 元素不可编辑，跳过处理');
    return;
  }
  
  console.log('✅ 元素可编辑，继续处理');
  
  const cursorInfo = getCursorPosition(element);
  if (!cursorInfo) {
    console.log('❌ 无法获取光标位置');
    return;
  }
  
  const { text, start: cursorPos } = cursorInfo;
  console.log('📍 光标信息:', { text: text.substring(Math.max(0, cursorPos - 10), cursorPos + 10), cursorPos });
  
  // 查找触发位置
  const triggerPos = findTriggerPosition(text, cursorPos);
  
  if (triggerPos) {
    console.log('🎯 找到触发序列:', triggerPos);
    
    // 找到触发序列
    const query = extractSearchQuery(text, triggerPos, cursorPos);
    console.log('🔍 搜索查询:', query);
    
    if (!state.isActive) {
      console.log('🚀 激活选择器');
      // 激活选择器
      state.currentElement = element;
      state.triggerPosition = triggerPos;
      state.lastTriggerChar = triggerPos.char;
      showSelector();
    } else {
      // 更新搜索查询
      state.triggerPosition = triggerPos;
    }
    
    // 更新搜索查询
    if (query !== state.searchQuery) {
      state.searchQuery = query;
      debounceSearch(query);
    }
  } else if (state.isActive) {
    console.log('❌ 未找到触发序列，隐藏选择器');
    // 没有找到触发序列，隐藏选择器
    hideSelector();
  }
}

/**
 * 键盘事件处理
 */
function handleKeyDown(event) {
  if (!state.isActive) return;
  
  const { key } = event;
  
  switch (key) {
    case CONFIG.KEYS.ESCAPE:
      event.preventDefault();
      event.stopPropagation();
      hideSelector();
      break;
      
    case CONFIG.KEYS.ENTER:
      if (state.selectedIndex >= 0 && state.selectedIndex < state.results.length) {
        event.preventDefault();
        event.stopPropagation();
        selectResult(state.selectedIndex);
      }
      break;
      
    case CONFIG.KEYS.ARROW_UP:
      event.preventDefault();
      event.stopPropagation();
      if (state.results.length > 0) {
        state.selectedIndex = state.selectedIndex <= 0 ? 
          state.results.length - 1 : state.selectedIndex - 1;
        updateSelection();
      }
      break;
      
    case CONFIG.KEYS.ARROW_DOWN:
      event.preventDefault();
      event.stopPropagation();
      if (state.results.length > 0) {
        state.selectedIndex = state.selectedIndex >= state.results.length - 1 ? 
          0 : state.selectedIndex + 1;
        updateSelection();
      }
      break;
      
    case CONFIG.KEYS.TAB:
      // Tab键可以用来选择当前项
      if (state.selectedIndex >= 0 && state.selectedIndex < state.results.length) {
        event.preventDefault();
        event.stopPropagation();
        selectResult(state.selectedIndex);
      }
      break;
  }
}

/**
 * 焦点事件处理
 */
function handleFocus(event) {
  // 当焦点离开当前编辑元素时，隐藏选择器
  if (state.isActive && event.target !== state.currentElement) {
    // 延迟隐藏，给点击选择器的时间
    setTimeout(() => {
      if (state.isActive && !state.selector?.contains(document.activeElement)) {
        hideSelector();
      }
    }, 100);
  }
}

/**
 * 点击事件处理
 */
function handleClick(event) {
  // 点击选择器外部时隐藏
  if (state.isActive && state.selector && !state.selector.contains(event.target)) {
    hideSelector();
  }
}

/**
 * 滚动事件处理
 */
function handleScroll() {
  if (state.isActive && state.selector) {
    // 重新定位选择器
    positionSelector();
  }
}

/**
 * 窗口大小变化处理
 */
function handleResize() {
  if (state.isActive && state.selector) {
    // 重新定位选择器
    positionSelector();
  }
}

/**
 * 消息事件处理
 */
function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'TRIGGER_SEARCH':
      // 全局快捷键触发搜索
      const activeElement = document.activeElement;
      if (isEditableElement(activeElement)) {
        state.currentElement = activeElement;
        state.triggerPosition = { position: 0, sequence: '//', char: '/' };
        state.lastTriggerChar = '/';
        showSelector();
        debounceSearch('');
      }
      break;
      
    case 'CAPTURE_CONTENT':
      // 捕获选中内容
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      if (selectedText) {
        sendResponse({ success: true, content: selectedText });
      } else {
        sendResponse({ success: false, error: '没有选中的内容' });
      }
      break;
      
    case 'GET_PAGE_INFO':
      // 获取页面信息
      sendResponse({
        success: true,
        data: {
          url: window.location.href,
          title: document.title,
          domain: window.location.hostname
        }
      });
      break;
      
    default:
      sendResponse({ success: false, error: '未知消息类型' });
  }
}

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script 收到消息:', message);
  
  switch (message.action) {
    case 'showCaptureDialog':
      showCaptureDialog(message.text);
      sendResponse({ success: true });
      break;
      
    default:
      console.log('未知消息类型:', message.action);
      sendResponse({ success: false, error: '未知消息类型' });
  }
  
  return true;
});

// ==================== 提示词捕获功能 ====================

/**
 * 显示捕获提示词的对话框
 */
function showCaptureDialog(selectedText) {
  // 移除已存在的对话框
  const existingDialog = document.getElementById('prompt-capture-dialog');
  if (existingDialog) {
    existingDialog.remove();
  }
  
  // 创建对话框
  const dialog = document.createElement('div');
  dialog.id = 'prompt-capture-dialog';
  dialog.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    padding: 20px;
    width: 500px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  `;
  
  dialog.innerHTML = `
    <div style="margin-bottom: 15px;">
      <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">保存提示词到 PromptMaster</h3>
      <p style="margin: 0; color: #666; font-size: 12px;">将选中的文本保存为提示词</p>
    </div>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">标题 *</label>
      <input type="text" id="prompt-title" placeholder="请输入提示词标题" 
             style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" />
    </div>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">内容 *</label>
      <textarea id="prompt-content" rows="6" placeholder="提示词内容" 
                style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; resize: vertical; box-sizing: border-box;">${selectedText}</textarea>
    </div>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">描述</label>
      <textarea id="prompt-description" rows="3" placeholder="提示词描述（可选）" 
                style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; resize: vertical; box-sizing: border-box;"></textarea>
    </div>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">分类</label>
      <input type="text" id="prompt-category" placeholder="例如：写作、编程、翻译" 
             style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" />
    </div>
    
    <div style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">标签</label>
      <input type="text" id="prompt-tags" placeholder="用逗号分隔，例如：AI,助手,工具" 
             style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box;" />
    </div>
    
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; font-weight: 500; color: #333;">
        <input type="checkbox" id="prompt-public" style="margin-right: 8px;" />
        公开提示词
      </label>
    </div>
    
    <div style="display: flex; gap: 10px; justify-content: flex-end;">
      <button id="cancel-capture" style="padding: 8px 16px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 14px;">取消</button>
      <button id="save-capture" style="padding: 8px 16px; border: none; background: #007bff; color: white; border-radius: 4px; cursor: pointer; font-size: 14px;">保存</button>
    </div>
    
    <div id="capture-status" style="margin-top: 10px; padding: 8px; border-radius: 4px; display: none;"></div>
  `;
  
  document.body.appendChild(dialog);
  
  // 聚焦到标题输入框
  const titleInput = dialog.querySelector('#prompt-title');
  titleInput.focus();
  
  // 绑定事件
  dialog.querySelector('#cancel-capture').addEventListener('click', () => {
    dialog.remove();
  });
  
  dialog.querySelector('#save-capture').addEventListener('click', () => {
    saveCapturedPrompt(dialog);
  });
  
  // ESC键关闭对话框
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      dialog.remove();
      document.removeEventListener('keydown', handleKeyDown);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  
  // 点击对话框外部关闭
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.remove();
    }
  });
}

/**
 * 保存捕获的提示词
 */
async function saveCapturedPrompt(dialog) {
  const title = dialog.querySelector('#prompt-title').value.trim();
  const content = dialog.querySelector('#prompt-content').value.trim();
  const description = dialog.querySelector('#prompt-description').value.trim();
  const category = dialog.querySelector('#prompt-category').value.trim();
  const tags = dialog.querySelector('#prompt-tags').value.trim();
  const isPublic = dialog.querySelector('#prompt-public').checked;
  
  const statusDiv = dialog.querySelector('#capture-status');
  const saveButton = dialog.querySelector('#save-capture');
  
  // 验证必填字段
  if (!title) {
    showCaptureStatus(statusDiv, '请输入标题', 'error');
    return;
  }
  
  if (!content) {
    showCaptureStatus(statusDiv, '请输入内容', 'error');
    return;
  }
  
  // 禁用保存按钮
  saveButton.disabled = true;
  saveButton.textContent = '保存中...';
  
  try {
    // 准备提示词数据
    const promptData = {
      title,
      content,
      description,
      category: category || '未分类',
      tags: tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
      isPublic,
      createdBy: 'Chrome Extension User' // 可以后续改为获取用户信息
    };
    
    console.log('准备保存提示词:', promptData);
    
    // 发送到background script
    const response = await chrome.runtime.sendMessage({
      action: 'createPrompt',
      promptData
    });
    
    if (response.success) {
      showCaptureStatus(statusDiv, '提示词保存成功！', 'success');
      setTimeout(() => {
        dialog.remove();
      }, 1500);
    } else {
      throw new Error(response.error || '保存失败');
    }
  } catch (error) {
    console.error('保存提示词失败:', error);
    showCaptureStatus(statusDiv, `保存失败: ${error.message}`, 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = '保存';
  }
}

/**
 * 显示捕获状态信息
 */
function showCaptureStatus(statusDiv, message, type) {
  statusDiv.style.display = 'block';
  statusDiv.textContent = message;
  
  if (type === 'success') {
    statusDiv.style.background = '#d4edda';
    statusDiv.style.color = '#155724';
    statusDiv.style.border = '1px solid #c3e6cb';
  } else if (type === 'error') {
    statusDiv.style.background = '#f8d7da';
    statusDiv.style.color = '#721c24';
    statusDiv.style.border = '1px solid #f5c6cb';
  }
}

// ==================== 初始化 ====================

/**
 * 初始化Content Script
 */
function initialize() {
  console.log('🚀 提示词管理器 Content Script 已加载');
  console.log('📍 当前页面:', window.location.href);
  
  // 检测页面中的可编辑元素
  const editableElements = document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]');
  console.log('🔍 检测到可编辑元素数量:', editableElements.length);
  
  // 添加事件监听器
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('focusin', handleFocus, true);
  document.addEventListener('click', handleClick, true);
  window.addEventListener('scroll', handleScroll, true);
  window.addEventListener('resize', handleResize, true);
  
  // 注意：消息监听器已在上方定义，这里不需要重复添加
  
  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    hideSelector();
  });
  
  // 动态监听新添加的元素
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const newEditableElements = node.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]');
          if (newEditableElements.length > 0) {
            console.log('🆕 检测到新的可编辑元素:', newEditableElements.length);
          }
        }
      });
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log('✅ 提示词管理器初始化完成');
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// ==================== 调试工具 ====================

// 开发模式下的调试功能
if (typeof window !== 'undefined') {
  window.promptManagerDebug = {
    getState: () => state,
    showSelector: () => showSelector(),
    hideSelector: () => hideSelector(),
    triggerSearch: (query) => {
      state.searchQuery = query;
      performSearch(query);
    },
    testTrigger: () => {
      console.log('🧪 开始测试触发功能...');
      const activeElement = document.activeElement;
      console.log('当前焦点元素:', activeElement);
      console.log('是否可编辑:', isEditableElement(activeElement));
      
      if (isEditableElement(activeElement)) {
        console.log('✅ 元素可编辑，模拟触发');
        state.currentElement = activeElement;
        state.triggerPosition = { position: 0, sequence: '//', char: '/' };
        state.lastTriggerChar = '/';
        showSelector();
        debounceSearch('test');
      } else {
        console.log('❌ 当前元素不可编辑');
      }
    },
    checkElements: () => {
      const allInputs = document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]');
      console.log('所有可能的输入元素:', allInputs);
      allInputs.forEach((el, index) => {
        console.log(`元素 ${index}:`, {
          tagName: el.tagName,
          type: el.type,
          contentEditable: el.contentEditable,
          isEditable: isEditableElement(el),
          className: el.className,
          id: el.id
        });
      });
    }
  };
  
  console.log('🔧 调试工具已加载，使用 window.promptManagerDebug 访问');
  console.log('💡 可用方法: testTrigger(), checkElements(), getState(), showSelector(), hideSelector()');
}