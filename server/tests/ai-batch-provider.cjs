/** Replace only external inference with deterministic photo evidence; never contact a paid provider. */
function installBatchProvider({ delay = 10, onCall = () => {}, shouldFail = () => false, beforeResponse = async () => {} } = {}) {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return original(url, options);
    onCall();
    await beforeResponse();
    await new Promise(resolve => setTimeout(resolve, delay));
    if (shouldFail()) return new Response(JSON.stringify({error:{message:'Fixture outage'}}),{status:503});
    const values = { name:'Fixture shirt',brand:'Fixture brand',color:'Green',size:'L',material:'Cotton',style:'BG-123',pattern:'Solid',fit:'Regular',sleeve:'Long' };
    const evidence = Object.fromEntries(Object.keys(values).map(key => [key,{source:'printed_label',observation:'BG-123 L Cotton Green 1 piece'}]));
    return new Response(JSON.stringify({id:'background-fixture',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
      values,visible_text:'BG-123 L Cotton Green 1 piece',confidence:Object.fromEntries(Object.keys(values).map(key=>[key,'High'])),evidence,
      stock_distribution:{detected:true,evidence_text:'1 piece',entries:[{variant_attributes:{size:'L'},quantity:1}],confidence:'High'},
    })}]}],usage:{input_tokens:10,output_tokens:10}}),{status:200});
  };
  return () => { global.fetch=original; };
}
module.exports = { installBatchProvider };
