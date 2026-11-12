#!/bin/bash
D="/mnt/user-data/uploads/CDC IFC"
P="CDC_AR地下層_SD_Central_0407"
run(){ echo "=== $2 $(date +%T)"; python3 -I convert.py "$D/$1" out/$2 $2 2>&1 | grep -v "^  " ; }
run "1150521A-3cI5WAMab7xgObT6L3YQvH.ifc" X
run "$P-開挖地形假設支撐用.ifc" EXC
run "$P-塑木設施-景觀.ifc" WOOD
run "$P-CDC_MEP地下層_弱電BA-SD.ifc" BA
run "$P-基地地界.ifc" SITE
run "$P-CDC_MEP地下層_給水CW-SD.ifc" CW
run "$P-排樁.ifc" PILE
run "$P-CDC_AR歷史建築_SD_Central_0407.ifc" HIS
run "$P-CDC_MEP地下層_排水PW-SD.ifc" PW
run "$P-CDC_AR行政棟_SD_Central_0407.ifc" OFF
run "$P-CDC_MEP地下層_消防FF-SD.ifc" FF
run "$P-CDC_MEP地下層_強電EP-SD.ifc" EP
run "$P-CDC_AR實驗棟_SD_Central_0407.ifc" LAB
run "$P-CDC_MEP地下層_空調AC-SD.ifc" AC
run "$P.ifc" BASE
echo ALLDONE $(date +%T)
