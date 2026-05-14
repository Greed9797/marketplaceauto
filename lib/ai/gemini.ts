import { GoogleGenerativeAI } from '@google/generative-ai'

type GerarCopyParams = {
  nomeProduto: string
  nicho: string
  estiloDescricao: string
  exemplosTitulos: string[]
  exemplosDescricoes: string[]
}

type GerarCopyResult = {
  titulo_ml: string
  titulo_shopee: string
  descricao: string
  categoria_ml_sugerida: string
  categoria_shopee_id: number
  atributos: Record<string, string>
}

function buildPrompt(params: GerarCopyParams) {
  return `Voce e especialista em e-commerce brasileiro. Gere anuncio para:

Produto: ${params.nomeProduto}
Nicho: ${params.nicho}
Estilo: ${params.estiloDescricao}

Exemplos de titulos que converteram:
${params.exemplosTitulos.map((titulo, index) => `${index + 1}. ${titulo}`).join('\n') || 'Nenhum exemplo informado.'}

Exemplos de descricoes aprovadas:
${params.exemplosDescricoes.map((descricao, index) => `${index + 1}. ${descricao}`).join('\n') || 'Nenhum exemplo informado.'}

Retorne APENAS JSON valido, sem markdown, sem explicacoes:
{"titulo_ml":"...","titulo_shopee":"...","descricao":"...","categoria_ml_sugerida":"...","categoria_shopee_id":0,"atributos":{}}`
}

function parseJson(text: string): GerarCopyResult {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  const parsed = JSON.parse(cleaned) as Partial<GerarCopyResult>

  return {
    titulo_ml: String(parsed.titulo_ml ?? '').slice(0, 60),
    titulo_shopee: String(parsed.titulo_shopee ?? '').slice(0, 120),
    descricao: String(parsed.descricao ?? ''),
    categoria_ml_sugerida: String(parsed.categoria_ml_sugerida ?? 'Outros'),
    categoria_shopee_id: Number(parsed.categoria_shopee_id ?? 0),
    atributos: Object.fromEntries(
      Object.entries(parsed.atributos ?? {}).map(([key, value]) => [key, String(value)]),
    ),
  }
}

export async function gerarCopy(params: GerarCopyParams): Promise<GerarCopyResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY nao configurada.')
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
  const result = await model.generateContent(buildPrompt(params))
  const text = result.response.text()
  return parseJson(text)
}
