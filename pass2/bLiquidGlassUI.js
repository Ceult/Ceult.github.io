/**
 * bLiquidGlassUI - High-level UI wrapper for bLiquidGlass
 * @version 1.1.3 (修复 group 属性传递)
 * @license MIT
 * @requires bLiquidGlass
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['bLiquidGlass'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./bLiquidGlass'));
  } else {
    if (!root.bLiquidGlass) {
      throw new Error('bLiquidGlassUI requires bLiquidGlass to be loaded first');
    }
    root.bLiquidGlassUI = factory(root.bLiquidGlass);
  }
}(typeof self !== 'undefined' ? self : this, function (bLiquidGlass) {
  'use strict';

  // ============================================================
  // Utility Functions
  // ============================================================

  function parseUnit(value, canvasSize) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      if (value.endsWith('%')) {
        return parseFloat(value) / 100 * canvasSize;
      }
      if (value.endsWith('px')) {
        return parseFloat(value);
      }
      return parseFloat(value);
    }
    return 0;
  }

  function injectStyles() {
    if (document.getElementById('blgui-styles')) return;

    const style = document.createElement('style');
    style.id = 'blgui-styles';
    style.textContent = `
      .blgui-container {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        touch-action: none;
      }

      .blgui-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
        pointer-events: auto;
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }

      .blgui-html-layer {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      .blgui-html-layer-back {
        z-index: 0;
      }

      .blgui-html-layer-front {
        z-index: 2;
      }

      .blgui-element {
        position: absolute;
        box-sizing: border-box;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // Main Class
  // ============================================================

  class bLiquidGlassUI {
    constructor(options = {}) {
      this.options = Object.assign({
        container: document.body,
        elements: [],
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        background: null,
        autoResize: true,
        forwardClickToHtml: true
      }, options);

      this.elements = [];
      this.elementMap = new Map();
      this.destroyed = false;

      injectStyles();
      this.createDOM();
      this.initGlass();
      this.bindEvents();

      if (this.options.elements.length > 0) {
        this.options.elements.forEach(elem => this.addElement(elem));
      }

      this.updateAllPositions();
    }

    createDOM() {
      const container = this.options.container;

      this.wrapper = document.createElement('div');
      this.wrapper.className = 'blgui-container';

      this.htmlLayerBack = document.createElement('div');
      this.htmlLayerBack.className = 'blgui-html-layer blgui-html-layer-back';

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'blgui-canvas';

      this.htmlLayerFront = document.createElement('div');
      this.htmlLayerFront.className = 'blgui-html-layer blgui-html-layer-front';

      this.wrapper.appendChild(this.htmlLayerBack);
      this.wrapper.appendChild(this.canvas);
      this.wrapper.appendChild(this.htmlLayerFront);

      container.appendChild(this.wrapper);
    }

    initGlass() {
      this.glass = new bLiquidGlass(this.canvas, [], {
        dpr: this.options.dpr,
        background: this.options.background
      });
    }

    bindEvents() {
      if (this.options.autoResize) {
        this.resizeHandler = () => this.handleResize();
        window.addEventListener('resize', this.resizeHandler);
      }

      this.animationFrame = () => {
        if (!this.destroyed) {
          this.updateAllPositions();
          requestAnimationFrame(this.animationFrame);
        }
      };
      requestAnimationFrame(this.animationFrame);
    }

    handleResize() {
      this.updateAllPositions();
    }

    // ============================================================
    // Element Management
    // ============================================================

    addElement(config) {
      const element = this.normalizeElement(config);
      this.elements.push(element);
      this.elementMap.set(element.id, element);

      // 保存原始 onClick 回调
      if (element.glass) {
        element._originalOnClick = element.glass.onClick;
      }

      // Add to glass - 关键修复：传递 group 属性
      if (element.glass) {
        const glassConfig = Object.assign({}, element.glass, {
          id: element.id,
          group: element.glass.group || null  // 确保 group 被传递
        });
        
        console.log('🔧 添加元素到 glass:', element.id, '| group:', glassConfig.group);
        this.glass.addElement(glassConfig);
      }

      // Create HTML element
      if (element.html !== null) {
        this.createHTMLElement(element);
        if (element.glass && this.options.forwardClickToHtml) {
          this.wrapGlassOnClick(element);
        }
      }

      this.updateElementPosition(element);
      return element;
    }

    wrapGlassOnClick(element) {
      const glassElement = this.glass.getElementById(element.id);
      if (!glassElement) return;

      const originalOnClick = element._originalOnClick;
      const htmlEl = element.htmlElement;
      const uiElement = element;

      glassElement.onClick = (e) => {
        const enhancedEvent = Object.assign({}, e, {
          uiElement: uiElement,
          htmlElement: htmlEl,
          _preventHtmlClick: false,
          preventDefault: function () { this._preventAnimation = true; },
          preventHtmlClick: function () { this._preventHtmlClick = true; }
        });

        if (typeof originalOnClick === 'function') {
          try {
            originalOnClick(enhancedEvent);
          } catch (error) {
            console.error('Error in element onClick handler:', error);
          }
        }

        if (htmlEl && !enhancedEvent._preventHtmlClick && this.options.forwardClickToHtml) {
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: e && e.mouse ? e.mouse.x : 0,
            clientY: e && e.mouse ? e.mouse.y : 0
          });
          htmlEl.dispatchEvent(clickEvent);
        }
      };

      element._wrappedOnClick = glassElement.onClick;
    }

    removeElement(id) {
      const element = this.elementMap.get(id);
      if (!element) return;

      if (element.glass) {
        const glassElement = this.glass.getElementById(id);
        if (glassElement) {
          const index = this.glass.elements.indexOf(glassElement);
          if (index !== -1) {
            this.glass.removeElement(index);
          }
        }
      }

      if (element.htmlElement && element.htmlElement.parentNode) {
        element.htmlElement.parentNode.removeChild(element.htmlElement);
      }

      const index = this.elements.indexOf(element);
      if (index !== -1) {
        this.elements.splice(index, 1);
      }
      this.elementMap.delete(id);
    }

    updateElement(id, config) {
      const element = this.elementMap.get(id);
      if (!element) return;

      if (config.glass) {
        Object.assign(element.glass, config.glass);
        this.glass.updateElementById(id, config.glass);
        if (config.glass.onClick !== undefined && this.options.forwardClickToHtml) {
          element._originalOnClick = config.glass.onClick;
          this.wrapGlassOnClick(element);
        }
      }

      if (config.html !== undefined) {
        element.html = config.html;
        if (element.htmlElement) {
          element.htmlElement.innerHTML = config.html || '';
        }
      }

      ['x', 'y', 'width', 'height', 'htmlLayer', 'syncTransform', 'htmlClass', 'htmlStyle'].forEach(key => {
        if (config[key] !== undefined) {
          element[key] = config[key];
        }
      });

      if (element.htmlElement) {
        if (config.htmlClass !== undefined) {
          element.htmlElement.className = 'blgui-element ' + (config.htmlClass || '');
        }
        if (config.htmlStyle) {
          Object.assign(element.htmlElement.style, config.htmlStyle);
        }
      }

      this.updateElementPosition(element);
    }

    getElementById(id) {
      return this.elementMap.get(id);
    }

    getElementsByGroup(groupName) {
      return this.elements.filter(e => e.glass && e.glass.group === groupName);
    }

    normalizeElement(config) {
      const defaults = {
        id: config.id || `element_${Date.now()}_${Math.random()}`,
        x: config.x !== undefined ? config.x : '50%',
        y: config.y !== undefined ? config.y : '50%',
        width: config.width !== undefined ? config.width : 200,
        height: config.height !== undefined ? config.height : 200,
        glass: config.glass || null,
        html: config.html !== undefined ? config.html : null,
        htmlLayer: config.htmlLayer || 'front',
        syncTransform: config.syncTransform !== undefined ? config.syncTransform : true,
        htmlClass: config.htmlClass || '',
        htmlStyle: config.htmlStyle || {},
        htmlElement: null,
        _originalOnClick: null,
        _wrappedOnClick: null
      };

      if (defaults.glass) {
        defaults.glass.id = defaults.id;
        if (defaults.glass.x === undefined) defaults.glass.x = defaults.x;
        if (defaults.glass.y === undefined) defaults.glass.y = defaults.y;
        if (defaults.glass.width === undefined) defaults.glass.width = defaults.width;
        if (defaults.glass.height === undefined) defaults.glass.height = defaults.height;
      }

      return defaults;
    }

    createHTMLElement(element) {
      const div = document.createElement('div');
      div.className = 'blgui-element ' + (element.htmlClass || '');
      div.setAttribute('data-element-id', element.id);

      if (element.html) {
        div.innerHTML = element.html;
      }

      Object.assign(div.style, element.htmlStyle);

      const layer = element.htmlLayer === 'back' ? this.htmlLayerBack : this.htmlLayerFront;
      layer.appendChild(div);

      element.htmlElement = div;
    }

    updateElementPosition(element) {
      if (!element.htmlElement) return;

      const dpr = this.options.dpr;
      const canvasWidth = this.canvas.width / dpr;
      const canvasHeight = this.canvas.height / dpr;

      let x, y, width, height, rotation = 0, scale = 1;

      if (element.glass) {
        const glassElement = this.glass.getElementById(element.id);
        if (!glassElement) return;

        const computed = this.glass.computeElementTransform(glassElement);
        x = computed.x / dpr;
        y = computed.y / dpr;
        width = computed.width / dpr;
        height = computed.height / dpr;

        if (element.syncTransform) {
          rotation = computed.rotation;
          scale = computed.scale;
        }
      } else {
        x = parseUnit(element.x, canvasWidth);
        y = parseUnit(element.y, canvasHeight);
        width = parseUnit(element.width, canvasWidth);
        height = parseUnit(element.height, canvasHeight);
      }

      const left = x - width / 2;
      const top = y - height / 2;

      element.htmlElement.style.left = left + 'px';
      element.htmlElement.style.top = top + 'px';
      element.htmlElement.style.width = width + 'px';
      element.htmlElement.style.height = height + 'px';

      if (element.syncTransform && rotation !== 0) {
        const rotationDeg = rotation * 180 / Math.PI;
        element.htmlElement.style.transform = `rotate(${rotationDeg}deg)`;
        element.htmlElement.style.transformOrigin = 'center center';
      } else {
        element.htmlElement.style.transform = '';
      }
    }

    updateAllPositions() {
      for (const elem of this.elements) {
        this.updateElementPosition(elem);
      }
    }

    // ============================================================
    // HTML 快捷方法
    // ============================================================

    setHTML(id, htmlString) {
      const element = this.elementMap.get(id);
      if (!element || !element.htmlElement) return;
      element.html = htmlString;
      element.htmlElement.innerHTML = htmlString;
    }

    getHTMLElement(id) {
      const element = this.elementMap.get(id);
      return element ? element.htmlElement : null;
    }

    // ============================================================
    // Glass 代理
    // ============================================================

    updateGlass(id, glassConfig) {
      const element = this.elementMap.get(id);
      if (!element || !element.glass) return;

      Object.assign(element.glass, glassConfig);
      this.glass.updateElementById(id, glassConfig);

      if (glassConfig.onClick !== undefined && this.options.forwardClickToHtml) {
        element._originalOnClick = glassConfig.onClick;
        this.wrapGlassOnClick(element);
      }
    }

    setGroupTransform(groupName, transform) {
      console.log('🎯 setGroupTransform 调用:', groupName, transform);
      this.glass.setGroupTransform(groupName, transform);
    }

    getGroupTransform(groupName) {
      return this.glass.getGroupTransform(groupName);
    }

    removeGroupTransform(groupName) {
      this.glass.removeGroupTransform(groupName);
    }

    // ============================================================
    // 控制
    // ============================================================

    pause() {
      this.glass.pause();
    }

    resume() {
      this.glass.resume();
    }

    destroy() {
      this.destroyed = true;

      if (this.resizeHandler) {
        window.removeEventListener('resize', this.resizeHandler);
      }

      this.glass.destroy();

      if (this.wrapper && this.wrapper.parentNode) {
        this.wrapper.parentNode.removeChild(this.wrapper);
      }

      this.elements = [];
      this.elementMap.clear();
    }
  }

  return bLiquidGlassUI;
}));
