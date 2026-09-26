// Test-only stdio server. No network or user credentials are used.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
const server=new Server({name:'fixture',version:'1'},{capabilities:{tools:{}}})
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',description:'Echo focused fixture text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]}))
server.setRequestHandler(CallToolRequestSchema,async request=>({content:[{type:'text',text:JSON.stringify({value:request.params.arguments?.text,scoped:process.env.FIXTURE_SECRET||'',unrelated:process.env.OPENAI_API_KEY?'present':'absent'})}]}))
await server.connect(new StdioServerTransport())
