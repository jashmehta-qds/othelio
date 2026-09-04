"use client";

import { useEffect, useRef } from "react";

const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentSource = `
precision highp float;
uniform vec2 resolution;
uniform vec2 pointer;
uniform float time;

float ribbonField(vec2 uv) {
  float t = uv.x;
  float cursor = exp(-10.0 * length(uv - pointer));
  float center = 0.50
    + 0.145 * sin(t * 7.4 + time * 0.42)
    + 0.045 * sin(t * 15.0 - time * 0.29)
    + cursor * 0.035;
  float width = 0.115
    + 0.035 * sin(t * 5.2 - time * 0.23)
    + 0.018 * sin(t * 13.0 + time * 0.36);
  float fold = 0.018 * sin(t * 28.0 + time * 0.74);
  return abs(uv.y - center + fold) - width;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  uv.y = 1.0 - uv.y;
  float aspect = resolution.x / resolution.y;
  vec2 sampleStep = vec2(1.5 / resolution.x, 1.5 / resolution.y);
  float field = ribbonField(uv);
  float alpha = 1.0 - smoothstep(-0.006, 0.008, field);
  if (alpha < 0.004) discard;

  float dx = ribbonField(uv + vec2(sampleStep.x, 0.0)) - ribbonField(uv - vec2(sampleStep.x, 0.0));
  float dy = ribbonField(uv + vec2(0.0, sampleStep.y)) - ribbonField(uv - vec2(0.0, sampleStep.y));
  vec3 normal = normalize(vec3(-dx * 42.0 * aspect, -dy * 42.0, 0.58));

  float inner = clamp(-field / 0.15, 0.0, 1.0);
  float corrugation = sin(uv.x * 42.0 + time * 0.55 + uv.y * 8.0) * 0.06;
  normal.x += corrugation;
  normal = normalize(normal);

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 keyLight = normalize(vec3(-0.45, -0.65, 0.82));
  vec3 rimLight = normalize(vec3(0.72, 0.28, 0.62));
  float key = pow(max(dot(reflect(-keyLight, normal), viewDir), 0.0), 28.0);
  float rim = pow(max(dot(reflect(-rimLight, normal), viewDir), 0.0), 9.0);
  float fresnel = pow(1.0 - max(normal.z, 0.0), 2.1);
  float edgeBand = 1.0 - smoothstep(0.0, 0.042, -field);
  float yellowGlint = edgeBand * (0.18 + 0.82 * pow(rim, 1.4));
  float brushed = 0.5 + 0.5 * sin(uv.x * resolution.x * 0.22 + sin(uv.y * 31.0));

  vec3 darkMetal = vec3(0.10, 0.11, 0.115);
  vec3 silver = vec3(0.70, 0.72, 0.73);
  vec3 whiteMetal = vec3(0.98, 0.97, 0.93);
  vec3 acidReflection = vec3(0.843, 1.0, 0.275);
  vec3 color = mix(darkMetal, silver, 0.26 + inner * 0.34 + normal.y * 0.18);
  color += whiteMetal * key * 1.15;
  color += silver * rim * 0.55;
  color += silver * fresnel * 0.26;
  color += brushed * 0.022;
  color = mix(color, acidReflection, yellowGlint * 0.42);
  color += acidReflection * edgeBand * key * 0.34;
  color *= 0.86 + 0.14 * sin(uv.x * 8.0 - time * 0.18);

  gl_FragColor = vec4(color, alpha * 0.96);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

export default function LiquidMetalRibbon() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!canvas || !gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, "resolution");
    const pointerUniform = gl.getUniformLocation(program, "pointer");
    const timeUniform = gl.getUniformLocation(program, "time");
    const pointer = { x: 0.5, y: 0.5 };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x += ((event.clientX - rect.left) / rect.width - pointer.x) * 0.22;
      pointer.y += ((event.clientY - rect.top) / rect.height - pointer.y) * 0.22;
    };
    const render = (now: number) => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform2f(pointerUniform, pointer.x, pointer.y);
      gl.uniform1f(timeUniform, reduced ? 0 : now * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduced) frame = requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move);
    render(0);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return <canvas ref={canvasRef} className="liquid-metal-canvas" aria-hidden="true" />;
}
