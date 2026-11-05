// Node counts an empty test file as a passing file wrapper. Record actual named
// test events separately so a mixed collection cannot hide an empty input file.
export default async function* executed(source){
 const events=[];
 for await(const event of source)if(event.type==='test:pass'||event.type==='test:fail'){
  const d=event.data;events.push({file:d.file,name:d.name,type:d.details?.type??'test',passed:event.type==='test:pass',skipped:!!d.skip,todo:!!d.todo});
 }
 yield JSON.stringify({events})+'\n';
}
