import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSchema } from "../src/contracts.js";
import { matchesFieldFilters, sanitizeFieldPreferences, unsetFieldFilter, visibleFields } from "../src/ui/field-preferences.js";

const board = boardSchema.parse({
  id:"project",title:"Workroom",number:1,url:"https://github.com/users/glebis/projects/1",closed:false,description:null,
  statusField:{id:"status",name:"Status",options:[]},singleSelectFields:[],dateFields:[],items:[],
  fields:[{id:"status",name:"Status",dataType:"SINGLE_SELECT"},{id:"priority",name:"Priority",dataType:"SINGLE_SELECT",options:[{id:"p1",name:"P1"},{id:"p2",name:"P2"}]},{id:"area",name:"Area",dataType:"SINGLE_SELECT",options:[{id:"sync",name:"Sync"}]},{id:"estimate",name:"Estimate",dataType:"NUMBER"},{id:"note",name:"Note",dataType:"TEXT"}],
});
const item = {singleSelect:{Priority:"P1",Area:"Sync"},numbers:{Estimate:0},text:{Note:"Needs review"}} as typeof board.items[number];
test("custom fields are visible by default without duplicating the grouping field; explicit empty selection stays empty", () => {
  assert.deepEqual(visibleFields(board).map(field=>field.name),["Priority","Area","Estimate","Note"]);
  assert.deepEqual(visibleFields(board,{visible:[],filters:{}}),[]);
  assert.deepEqual(visibleFields(board,{visible:["area","removed"],filters:{}}).map(field=>field.name),["Area"]);
});
test("field filters use actual option IDs, combine with AND, handle unset values and numeric zero", () => {
  assert.equal(matchesFieldFilters(board,item,{priority:"p1",area:"sync"}),true);
  assert.equal(matchesFieldFilters(board,item,{priority:"p2",area:"sync"}),false);
  assert.equal(matchesFieldFilters(board,item,{priority:unsetFieldFilter}),false);
  assert.equal(matchesFieldFilters(board,{...item,singleSelect:{}},{priority:unsetFieldFilter}),true);
  assert.equal(matchesFieldFilters(board,item,{estimate:"0",note:"REVIEW"}),true);
  assert.equal(matchesFieldFilters(board,item,{estimate:"1"}),false);
  assert.equal(matchesFieldFilters(board,item,{priority:"deleted-option",removed:"x"}),true);
});
test("field preferences restore explicit visibility/filters and ignore corrupt storage", () => {
  assert.deepEqual(sanitizeFieldPreferences(null),{});
  assert.deepEqual(sanitizeFieldPreferences([]),{});
  assert.deepEqual(sanitizeFieldPreferences({"glebis:1":{visible:["area","area",42],filters:{priority:"p1",bad:42}},broken:42}),{"glebis:1":{visible:["area"],filters:{priority:"p1"}}});
});

test("priority chips OR options and unset, while other fields remain AND criteria", () => {
  assert.equal(matchesFieldFilters(board,item,{priority:["p1","p2"],area:"sync"}),true);
  assert.equal(matchesFieldFilters(board,item,{priority:["p2",unsetFieldFilter]}),false);
  assert.equal(matchesFieldFilters(board,{...item,singleSelect:{Area:"Sync"}},{priority:["p2",unsetFieldFilter],area:"sync"}),true);
  assert.equal(matchesFieldFilters(board,item,{priority:["p1","p2"],area:unsetFieldFilter}),false);
  assert.equal(matchesFieldFilters(board,item,{priority:[]}),true);
});

test("mixed deleted option IDs apply valid choices; all deleted selections are ignored", () => {
  assert.equal(matchesFieldFilters(board,item,{priority:["deleted","p2"]}),false);
  assert.equal(matchesFieldFilters(board,item,{priority:["deleted","p1"]}),true);
  assert.equal(matchesFieldFilters(board,item,{priority:["deleted"],removed:["p2"]}),true);
  assert.equal(matchesFieldFilters(board,item,{estimate:["1"],note:["missing"]}),true);
  assert.equal(matchesFieldFilters(board,item,{estimate:"0"}),true);
});

test("legacy scalar filters survive storage and array selections are bounded/sanitized", () => {
  const saved = sanitizeFieldPreferences({ first: { filters: { priority: "p1", area: ["sync", "sync", 5, {}, "", "x".repeat(201)], estimate: "0" } } });
  assert.deepEqual(saved.first.filters,{priority:"p1",area:["sync"],estimate:"0"});
  const large = sanitizeFieldPreferences({ first: { filters: { priority: Array.from({length:120},(_,i)=>String(i)) } } });
  assert.equal((large.first.filters.priority as string[]).length,100);
});

test("chip toggle migrates scalar and removes selections without mutating input", async () => {
  const { toggleFieldFilter, activeFieldFilterCount } = await import("../src/ui/field-preferences.js");
  assert.deepEqual(toggleFieldFilter("p1","p2"),["p1","p2"]);
  assert.deepEqual(toggleFieldFilter("p1","p1"),[]);
  const selected=["p1",unsetFieldFilter];
  assert.deepEqual(toggleFieldFilter(selected,"p1"),[unsetFieldFilter]);
  assert.deepEqual(selected,["p1",unsetFieldFilter]);
  assert.equal(activeFieldFilterCount(board,{priority:["p1","p2"],estimate:"0",removed:"x"}),2);
  assert.equal(activeFieldFilterCount(board,{priority:["deleted"],area:[],estimate:["0"]}),0);
  assert.equal(activeFieldFilterCount(board,{priority:[unsetFieldFilter,"deleted"]}),1);
});
