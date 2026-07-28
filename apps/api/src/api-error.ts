export function internalServerErrorPayload(requestId: string) {
  return {
    error: "服务器暂时无法完成请求，请稍后重试。",
    requestId
  };
}
