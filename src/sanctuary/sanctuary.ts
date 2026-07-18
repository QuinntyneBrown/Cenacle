import { ReduceMotion } from "../core/accessibility";
import type { LocalStore } from "../core/local-store";
import { FrameScheduler, WorkClass } from "../core/performance";

export enum VisualMode {
  GpuAtmosphere = "gpu-atmosphere",
  Still = "still"
}

export interface AudioFrame { amplitude: number; bands: number[]; }
export interface ShaderParams extends AudioFrame { motionGain: number; }

export class VisualsSettings {
  visualsEnabled = true;
  audioReactiveEnabled = true;
  reduceMotion = false;

  constructor(private readonly store: LocalStore, private readonly reduceMotionService = new ReduceMotion()) {
    this.load();
    this.reduceMotion = reduceMotionService.enabled;
    reduceMotionService.observe((value) => { this.reduceMotion = value; });
  }

  load(): void {
    const settings = this.store.loadSettings();
    this.visualsEnabled = settings.ambientVisualsEnabled;
    this.audioReactiveEnabled = settings.audioReactiveEnabled;
  }

  setEnabled(on: boolean): void {
    this.visualsEnabled = on;
    const settings = this.store.loadSettings();
    this.store.saveSettings({ ...settings, ambientVisualsEnabled: on });
  }

  setAudioReactive(on: boolean): void {
    this.audioReactiveEnabled = on;
    const settings = this.store.loadSettings();
    this.store.saveSettings({ ...settings, audioReactiveEnabled: on });
  }

  audioReactiveActive(): boolean { return this.visualsEnabled && this.audioReactiveEnabled; }

  motionGain(): number {
    if (!this.audioReactiveActive()) return 0;
    return this.reduceMotion ? 0.08 : 1;
  }
}

export class AudioAnalyser {
  private analyserNode: AnalyserNode | null = null;
  private frequency = new Uint8Array(0);
  private timeDomain = new Uint8Array(0);

  connect(source: AudioNode): void {
    this.analyserNode = source.context.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.72;
    source.connect(this.analyserNode);
    this.frequency = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.timeDomain = new Uint8Array(this.analyserNode.fftSize);
  }

  sample(): AudioFrame {
    if (!this.analyserNode) return { amplitude: 0, bands: [0, 0, 0, 0] };
    this.analyserNode.getByteFrequencyData(this.frequency);
    this.analyserNode.getByteTimeDomainData(this.timeDomain);
    const amplitude = Math.sqrt(this.timeDomain.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / this.timeDomain.length);
    const bands = [0, 1, 2, 3].map((band) => {
      const start = Math.floor((this.frequency.length / 4) * band);
      const end = Math.floor((this.frequency.length / 4) * (band + 1));
      const slice = this.frequency.slice(start, end);
      return slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length) / 255;
    });
    return { amplitude, bands };
  }
}

export class WebGpuProbe {
  async isAvailable(): Promise<boolean> {
    try { return Boolean(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
  }
}

export class StillBackdrop {
  constructor(private readonly element: HTMLElement) {}
  show(): void { this.element.dataset.visualMode = VisualMode.Still; }
  hide(): void { delete this.element.dataset.visualMode; }
}

const SHADER = `
struct Uniforms { time: f32, amplitude: f32, motion: f32, bass: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  var positions = array<vec2f, 3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
  var out: VertexOut;
  out.position = vec4f(positions[index], 0.0, 1.0);
  out.uv = positions[index] * 0.5 + 0.5;
  return out;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let p = input.uv - vec2f(0.52, 0.48);
  let breathe = sin(u.time * (0.15 + u.amplitude * u.motion) + length(p) * 8.0) * 0.04 * u.motion;
  let glow = 1.0 - smoothstep(0.05, 0.85, length(p) + breathe);
  let ember = vec3f(0.83, 0.31, 0.13) * glow * (0.18 + u.bass * u.motion);
  let navy = mix(vec3f(0.025, 0.06, 0.10), vec3f(0.07, 0.14, 0.22), input.uv.y);
  return vec4f(navy + ember, 1.0);
}`;

export class SanctuaryRenderer {
  readonly targetFps = 60;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private frame = 0;
  private startedAt = 0;
  private readonly scheduler = new FrameScheduler();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly settings: VisualsSettings,
    private readonly analyser: AudioAnalyser
  ) {}

  async start(): Promise<void> {
    if (!navigator.gpu) throw new DOMException("WebGPU is unavailable.", "NotSupportedError");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
    if (!adapter) throw new DOMException("No WebGPU adapter is available.", "NotSupportedError");
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu");
    if (!this.context) throw new DOMException("WebGPU canvas context is unavailable.", "NotSupportedError");
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format, alphaMode: "opaque" });
    const module = this.device.createShaderModule({ code: SHADER });
    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" }
    });
    this.uniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
    });
    this.startedAt = performance.now();
    this.renderFrame();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.device?.destroy();
    this.device = null;
  }

  renderFrame = (): void => {
    if (!this.device || !this.context || !this.pipeline || !this.uniformBuffer || !this.bindGroup) return;
    this.scheduler.schedule([
      {
        workClass: WorkClass.AudioReactive,
        essential: false,
        run: () => {
          const audio = this.settings.audioReactiveActive() ? this.analyser.sample() : { amplitude: 0, bands: [0] };
          const params = new Float32Array([
            (performance.now() - this.startedAt) / 1000,
            audio.amplitude,
            this.settings.motionGain(),
            audio.bands[0] ?? 0
          ]);
          this.device?.queue.writeBuffer(this.uniformBuffer!, 0, params);
        }
      },
      {
        workClass: WorkClass.Ambient,
        essential: false,
        run: () => {
          const encoder = this.device!.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: this.context!.getCurrentTexture().createView(),
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0.025, g: 0.06, b: 0.1, a: 1 }
            }]
          });
          pass.setPipeline(this.pipeline!);
          pass.setBindGroup(0, this.bindGroup!);
          pass.draw(3);
          pass.end();
          this.device!.queue.submit([encoder.finish()]);
        }
      }
    ]);
    this.frame = requestAnimationFrame(this.renderFrame);
  };
}

export class SanctuaryLayer {
  private renderer: SanctuaryRenderer | null = null;
  constructor(
    private readonly settings: VisualsSettings,
    private readonly probe: WebGpuProbe,
    private readonly still: StillBackdrop
  ) {}

  async resolve(): Promise<VisualMode> {
    return this.settings.visualsEnabled && !this.settings.reduceMotion && await this.probe.isAvailable()
      ? VisualMode.GpuAtmosphere
      : VisualMode.Still;
  }

  async mount(canvas: HTMLCanvasElement, analyser = new AudioAnalyser()): Promise<VisualMode> {
    const mode = await this.resolve();
    if (mode === VisualMode.Still) {
      this.still.show();
      return mode;
    }
    this.still.hide();
    this.renderer = new SanctuaryRenderer(canvas, this.settings, analyser);
    await this.renderer.start();
    return mode;
  }

  unmount(): void { this.renderer?.stop(); }
}
