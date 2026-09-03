
class TimeManager {
  static TIME_CONFIG ={
    0: { // 深夜
        sky: ['#0a0f2e', '#1a2352'],
        ground: '#1a1a2e',
        cloud: { hue: 240, brightness: 0.3 }
    },
    6: { // 日出
        sky: ['#ffd7b5', '#ffb88c'],
        ground: '#5a4738',
        cloud: { hue: 25, brightness: 1.4 }
    },
    9: { // 早晨
        sky: ['#a8d8ff', '#d6f0ff'],
        ground: '#6b8c6d',
        cloud: { hue: 0, brightness: 1.8 }  // 更白的云
    },
    12: { // 正午
        sky: ['#7ec8ff', '#f0f9ff'],
        ground: '#7ea56d',
        cloud: { hue: -5, brightness: 2.0 } // 最白的云
    },
    15: { // 下午
        sky: ['#6cb4ee', '#e6f4ff'],        // 保持冷色调
        ground: '#6b8c6d',
        cloud: { hue: 0, brightness: 1.6 }
    },
    17: { // 黄昏开始
        sky: ['#ffb347', '#ffd689'],
        ground: '#8c684a',
        cloud: { hue: 30, brightness: 1.2 }
    },
    19: { // 日落后
        sky: ['#303f9f', '#1a237e'],
        ground: '#2d2d5c',
        cloud: { hue: 250, brightness: 0.4 }
    }
  }

  static getCurrentTime() {
    const now = new Date();
    return {
      hour: now.getHours(),
      minutes: now.getMinutes(),
      decimalHour: now.getHours() + now.getMinutes()/60
    };
  }

  static getTimeRange(currentHour) {
    const times = Object.keys(this.TIME_CONFIG).map(Number).sort((a,b) => a-b);
    let nextTime = times.find(t => t > currentHour) || times[0];
    let prevTime = [...times].reverse().find(t => t <= currentHour) || times[times.length-1];
    return { prevTime, nextTime };
  }
}

class ColorInterpolator {
  static interpolateColor(c1, c2, p) {
    const parseHex = (hex) => parseInt(hex, 16);
    const components = [1,3,5].map(start => [
      parseHex(c1.substring(start, start+2)),
      parseHex(c2.substring(start, start+2))
    ]);
    
    return `#${components.map(([a, b]) => 
      Math.round(a * (1-p) + b * p).toString(16).padStart(2, '0')
    ).join('')}`;
  }

  static interpolateConfig(prev, next, progress) {
    return {
      sky: [
        this.interpolateColor(prev.sky[0], next.sky[0], progress),
        this.interpolateColor(prev.sky[1], next.sky[1], progress)
      ],
      ground: this.interpolateColor(prev.ground, next.ground, progress),
      cloud: {
        hue: prev.cloud.hue * (1-progress) + next.cloud.hue * progress,
        brightness: prev.cloud.brightness * (1-progress) + next.cloud.brightness * progress
      }
    };
  }
}

class SceneManager {
  constructor() {
    this.celestialElement = null;
    this.backgroundElement = document.querySelector("#background");
    this.groundElement = document.querySelector('#ground');
    this.cloudElement = document.querySelector('#cloud');
  }

  updateSky(colors) {
    this.backgroundElement.style.background = `linear-gradient(to bottom, ${colors.join(', ')})`;
  }

  updateGround(color) {
    this.groundElement.style.backgroundColor = color;
  }

  updateCloud({ hue, brightness }) {
    this.cloudElement.style.filter = `hue-rotate(${hue}deg) brightness(${brightness})`;
  }

  updateCelestial(config) {
    const { decimalHour } = TimeManager.getCurrentTime();
    const isDay = decimalHour > 6 && decimalHour < 20;
    
    if (!this.celestialElement) {
      this.celestialElement = this.createCelestialElement(isDay);
    }

    this.updateCelestialPosition(decimalHour);
    this.updateCelestialType(isDay);
  }

  createCelestialElement(isDay) {
    const element = document.createElement('div');
    element.className = `${isDay ? 'sun' : 'moon'} celestial`;
    this.backgroundElement.appendChild(element);
    return element;
  }

  updateCelestialPosition(hour) {
    const progress = (hour - 6) / 24;
    this.celestialElement.style.left = `${50 + Math.cos(progress * Math.PI * 2) * 45}%`;
    this.celestialElement.style.top = `${25 + Math.sin(progress * Math.PI * 2) * 10}%`;
  }

  updateCelestialType(isDay) {
    const targetType = isDay ? 'sun' : 'moon';
    this.celestialElement.classList.replace(
      this.celestialElement.classList[0], 
      targetType
    );
  }
}

// 主控制器
class SceneController {
  constructor() {
    this.sceneManager = new SceneManager();
    this.updateInterval = null;
  }

  initialize() {
    this.updateScene();
    this.setupAutoUpdate();
  }

  getCurrentConfig() {
    const { hour, minutes } = TimeManager.getCurrentTime();
    const { prevTime, nextTime } = TimeManager.getTimeRange(hour);
    
    const totalMinutes = ((nextTime - prevTime + 24) % 24) * 60;
    const elapsedMinutes = (hour - prevTime) * 60 + minutes;
    const progress = elapsedMinutes / totalMinutes;
    
    return ColorInterpolator.interpolateConfig(
      TimeManager.TIME_CONFIG[prevTime],
      TimeManager.TIME_CONFIG[nextTime],
      progress
    );
  }

  updateScene() {
    const config = this.getCurrentConfig();
    this.sceneManager.updateSky(config.sky);
    this.sceneManager.updateGround(config.ground);
    this.sceneManager.updateCloud(config.cloud);
    this.sceneManager.updateCelestial(config);
  }

  setupAutoUpdate() {
    this.updateInterval = setInterval(() => this.updateScene(), 60000);
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const controller = new SceneController();
  controller.initialize();
});