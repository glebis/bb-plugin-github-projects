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
