import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../client-source.js',import.meta.url),'utf8')
const start=source.indexOf('    function RejectCandidateControl('),end=source.indexOf('    function AnswerRunModal',start)
function harness(result={resumed:true}) {
 const states=[],calls=[];let index=0,done=0
 const item={id:'REQ-1',rejectionReview:{allowed:true,stale:true,binding:{runId:'RUN-014',candidateId:'CAND-003',source:{treeHash:'fresh'}}}}
 const context=vm.createContext({T:{},ModalShell:'modal',
  useState(initial){const i=index++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=value}]},
  h(type,props,...children){return {type,props:props??{},children:children.flat()}},
  writeJson:async(action,body,root)=>{calls.push({action,body:JSON.parse(JSON.stringify(body)),root});return result}})
 // Load the actual lexical style declaration; do not invent a test-only alias.
 const buttonStart=source.indexOf('    const button = {'),buttonEnd=source.indexOf('\n    // Primary actions',buttonStart)
 vm.runInContext(source.slice(buttonStart,buttonEnd)+'\n'+source.slice(start,end)+'\nthis.Control=RejectCandidateControl;this.actualButton=button',context)
 function render(){index=0;return context.Control({item,root:'D:/root',onDone(){done++}})}
 function nodes(tree){return [tree,...(tree?.children??[]).flatMap(child=>child&&typeof child==='object'?nodes(child):[])]}
 return {states,calls,item,render,nodes,actualButton:context.actualButton,done:()=>done}
}
test('closed and open control render with actual lexical button style and no fabricated binding',()=>{
 const f=harness();let tree
 assert.doesNotThrow(()=>{tree=f.render()})
 assert.equal(f.nodes(tree).find(n=>n.type==='button').props.style,f.actualButton)
 f.nodes(tree).find(n=>n.type==='button').props.onClick()
 assert.doesNotThrow(()=>{tree=f.render()})
 assert.ok(f.nodes(tree).find(n=>n.type==='textarea'))
})
test('isolated real form defaults blank, cancel writes nothing, and submits only original reviewed binding',async()=>{
 const f=harness();let tree=f.render()
 f.nodes(tree).find(n=>n.type==='button').props.onClick();tree=f.render()
 assert.equal(f.states[2],'')
 const modal=f.nodes(tree).find(n=>n.type==='modal')
 assert.match(modal.props.lead,/RUN-014.*CAND-003/)
 assert.equal(modal.props.footer[1].props.disabled,true)
 modal.props.footer[0].props.onClick();assert.equal(f.calls.length,0)
 tree=f.render();f.nodes(tree).find(n=>n.type==='button').props.onClick();tree=f.render()
 f.nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'Actual failed behavior'}})
 // A background refresh must not silently retarget an already opened form.
 f.item.rejectionReview={allowed:true,binding:{runId:'RUN-NEW',candidateId:'CAND-NEW'}}
 tree=f.render();await f.nodes(tree).find(n=>n.type==='modal').props.footer[1].props.onClick()
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.mode,'reject-candidate')
 assert.equal(f.calls[0].body.expectedReview.runId,'RUN-014')
 assert.equal(f.calls[0].body.answer,'Actual failed behavior');assert.equal(f.done(),1)
})
test('background disallow preserves opened review and human feedback instead of unmounting form',()=>{
 const f=harness();f.nodes(f.render()).find(n=>n.type==='button').props.onClick()
 f.nodes(f.render()).find(n=>n.type==='textarea').props.onChange({target:{value:'Preserve after background refresh'}})
 f.item.rejectionReview={allowed:false,binding:null}
 const tree=f.render();assert.equal(f.nodes(tree).find(n=>n.type==='textarea').props.value,'Preserve after background refresh')
 assert.match(f.nodes(tree).find(n=>n.type==='modal').props.lead,/RUN-014.*CAND-003/)
 assert.equal(f.calls.length,0)
})
test('real form business refusal preserves feedback and does not reload as success',async()=>{
 const f=harness({resumed:false,message:'stale reviewed source'})
 f.nodes(f.render()).find(n=>n.type==='button').props.onClick()
 f.nodes(f.render()).find(n=>n.type==='textarea').props.onChange({target:{value:'Keep my feedback'}})
 await f.nodes(f.render()).find(n=>n.type==='modal').props.footer[1].props.onClick()
 assert.equal(f.states[2],'Keep my feedback');assert.equal(f.done(),0)
 assert.match(f.nodes(f.render()).find(n=>n.props.role==='alert').children.join(''),/stale reviewed source/)
})
