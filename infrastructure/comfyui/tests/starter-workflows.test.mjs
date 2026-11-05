import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=name=>JSON.parse(readFileSync(new URL('../workflows/'+name,import.meta.url),'utf8'));
test('owned image2 starter keeps selection, asset links and a fresh request identity',()=>{
 const graph=read('image2-select-wan.json');
 for(const type of ['ZenithJoyImage2','ZenithJoyChooseAsset','ZenithJoyWan','SaveVideo'])assert.ok(graph.nodes.some(n=>n.type===type),'missing '+type);
 for(const node of graph.nodes.filter(n=>['ZenithJoyImage2','ZenithJoyWan'].includes(n.type)))assert.equal(node.widgets_values_named.request_id,'','starter graph must not reuse a request ID');
 assert.ok(graph.links.some(link=>link[5]==='ZENITHJOY_ASSET'),'starter graph must connect owned assets');
});
test('uploaded starter sends owned asset identity through selection into Wan',()=>{
 const graph=read('upload-image-wan.json');
 for(const type of ['LoadImage','ZenithJoyUploadImage','ZenithJoyChooseAsset','ZenithJoyWan','SaveVideo'])assert.ok(graph.nodes.some(n=>n.type===type),'missing '+type);
 assert.equal(graph.nodes.find(n=>n.type==='ZenithJoyWan').widgets_values_named.request_id,'','uploaded starter graph must use a new request ID');
 assert.ok(graph.links.some(link=>link[5]==='ZENITHJOY_ASSET'),'uploaded graph must connect owned assets');
});
