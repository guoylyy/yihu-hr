/** 平台模型列表（OpenAI /models 形态）里 default: true 的就是不传 model 时用的，没标的取第一个 */
export function defaultModelName(list) {
  const models = Array.isArray(list) ? list : []
  const m = models.find(x => x?.default) ?? models[0]
  return m?.name || m?.id || null
}
