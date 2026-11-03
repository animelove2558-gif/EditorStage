// WebGL2 compositor: draws a source (VideoFrame / canvas / image) through a Lumetri-style color shader.
const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; uv.y = 1.0-uv.y; gl_Position = vec4(p,0,1); }`;

const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex;
uniform float exposure, contrast, saturation, temperature, tint, vignette, opacity;
void main(){
  vec4 c = texture(tex, uv);
  vec3 r = c.rgb * exp2(exposure);
  r.r += temperature*0.1; r.b -= temperature*0.1; r.g += tint*0.1;
  r = (r-0.5)*(1.0+contrast)+0.5;
  float l = dot(r, vec3(0.2126,0.7152,0.0722));
  r = mix(vec3(l), r, 1.0+saturation);
  float d = distance(uv, vec2(0.5));
  r *= 1.0 - vignette*smoothstep(0.3,0.9,d);
  o = vec4(clamp(r,0.0,1.0), c.a*opacity);
}`;

export class WebGLRenderer {
  constructor(canvas) {
    const gl = (this.gl = canvas.getContext('webgl2', { premultipliedAlpha: false }));
    if (!gl) throw new Error('WebGL2 unavailable');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (this.prog = gl.createProgram());
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    this.params = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, vignette: 0, opacity: 1 };
  }

  setParams(p) { Object.assign(this.params, p); }

  draw(source) {
    const { gl, prog } = this;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    for (const [k, v] of Object.entries(this.params)) gl.uniform1f(gl.getUniformLocation(prog, k), v);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
