// 背面世界坐标 / 世界法线信息预通道（供正面玻璃通道做第二次折射）。
//
// 结构与取值来自 vercel-labs/vgpu 官方 MIT 仓库的 prism 与 transmission 示例
// （commit 81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5；见 THIRD_PARTY.md 与
// third-party-licenses/vgpu-LICENSE.txt）：vGPU 官方 Transmission 示例用解析
// 求交拿到出射面位置与法线；本工具不能写死立方体，所以沿用现有任意闭合挤出
// 网格，把「背面界面的位置与法线」烘进两张颜色附件。法线朝向用背面通道同款
// `select(-normal, normal, dot(normal, view) > 0)` 规则。顶点布局与主网格一致
// （position / normal / uv，显式 location 0/1/2），uv 只是保持共用几何布局。
//
// 屏幕空间近似限制：这里记录的是「当前屏幕像素最先命中的背面片元」，折射后
// 的出射点与该命中像素不一定逐像素对齐；这是有限近似，不是完整光线追踪。
// 两次折射的语义（空气→玻璃、玻璃→空气）与官方一致。

struct BackInfoCamera {
  view_projection: mat4x4f,
  camera_position: vec3f,
};

@group(0) @binding(0) var<uniform> camera: BackInfoCamera;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world_position: vec3f,
  @location(1) world_normal: vec3f,
  @location(2) uv: vec2f,
};

struct BackInfoOut {
  @location(0) world_position: vec4f,
  @location(1) world_normal: vec4f,
};

@vertex
fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
) -> VertexOut {
  var out: VertexOut;
  out.position = camera.view_projection * vec4f(position, 1.0);
  out.world_position = position;
  out.world_normal = normal;
  out.uv = uv;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> BackInfoOut {
  let geometric_normal = normalize(in.world_normal);
  let view = normalize(camera.camera_position - in.world_position);
  let world_normal = select(-geometric_normal, geometric_normal, dot(geometric_normal, view) > 0.0);
  return BackInfoOut(vec4f(in.world_position, 1.0), vec4f(world_normal, 1.0));
}
