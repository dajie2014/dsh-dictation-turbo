// 宿主半体：这个插件完全不需要宿主侧能力，留个空实现即可。
// 客户端半体（./client）自己监听键盘、自己点界面上的麦克风按钮。
export const name = 'dictation-turbo'

export function apply() {
  // 有意为空：不注册任何宿主服务、不读不写任何文件。
}
