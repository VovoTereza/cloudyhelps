import { proxyResend } from "../_lib/resend-proxy.mjs";

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).send("Método não permitido.");
  }
  return proxyResend(request, response, "unsubscribe");
}
