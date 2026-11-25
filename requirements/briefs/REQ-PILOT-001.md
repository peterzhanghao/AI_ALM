# REQ-PILOT-001 Purchase list pagination

## 目标
Show a purchase list in stable pages of 20 items.

## 问题与场景
A purchaser needs to inspect a 45-item result set without losing or repeating rows.

## 验收要求
- AC-01 A 45-item list yields pages of 20, 20 and 5 items.
- AC-02 All pages preserve source order with no duplicated or missing items.
- AC-03 Changing a filter resets the selected page to page one.
- AC-04 Empty results and the last page expose the correct navigation state.
