import test from 'node:test';
import assert from 'node:assert/strict';
import {freshFilters,filterTasks,facetCount} from '../static/catalog.js';
const task=(id,industry,score,skills,fit,date='2026-09-23',level='ready')=>({id,industry,status:'published',createdAt:date,score:{total:score,level},requiredSkills:skills.map(name=>({name,confirmed:true})),match:{score:fit},fields:{title:id,need:''},draft:'',workMode:'remote'});
const tasks=[task('a','Финансы',90,['Python','SQL'],40,'2026-09-20','priority'),task('b','IT',70,['Python'],80),task('c','IT',30,['SQL'],null),{...task('draft','IT',100,[],100),status:'draft'}];
test('combined industry, skills, rating, relevance and dates use intersection',()=>{
 const f={...freshFilters(),industries:['IT'],skills:['Python'],minScore:60,minMatch:70,from:'2026-09-21',to:'2026-09-23'};
 assert.deepEqual(filterTasks(tasks,f).map(t=>t.id),['b']);
});
test('multi-select OR within facet, optional ALL skills',()=>{
 let f={...freshFilters(),industries:['IT','Финансы'],skills:['Python','SQL']};assert.equal(filterTasks(tasks,f).length,3);
 f.skillMode='all';assert.deepEqual(filterTasks(tasks,f).map(t=>t.id),['a']);
});
test('facet counts reflect every other active group',()=>{
 const f={...freshFilters(),industries:['IT'],skills:['SQL'],minScore:60};
 assert.equal(facetCount(tasks,f,'skills','Python'),1);assert.equal(facetCount(tasks,f,'industries','Финансы'),1);
});
test('readiness default, personal sorting explicit; unknown match never meets threshold',()=>{
 assert.deepEqual(filterTasks(tasks,freshFilters()).map(t=>t.id),['a','b','c']);
 assert.deepEqual(filterTasks(tasks,{...freshFilters(),sort:'relevance',minMatch:1}).map(t=>t.id),['b','a']);
});
test('no candidates and reset do not hide low scores globally',()=>{
 assert.equal(filterTasks(tasks,{...freshFilters(),skills:['Power BI']}).length,0);
 assert.equal(filterTasks(tasks,freshFilters()).length,3);
});
test('unconfirmed skills not filterable, date boundaries inclusive',()=>{
 const item=task('x','IT',70,[],70);item.requiredSkills=[{name:'Rust',confirmed:false}];
 assert.equal(filterTasks([item],{...freshFilters(),skills:['Rust']}).length,0);
 assert.equal(filterTasks([item],{...freshFilters(),from:'2026-09-23',to:'2026-09-23'}).length,1);
});
