Ext.define('CustomApp', {
	extend : 'Rally.app.App',
	items : [ {
		xtype : 'container',
		itemId : 'fieldContainer'
	}, {
		xtype : 'container',
		itemId : 'buttonContainer',
		cls : 'container buttonContainer'
	}, {
		xtype : 'container',
		itemId : 'gridContainer',
		cls : 'container'
	}, {
		xtype : 'container',
		itemId : 'tableContainer',
		cls : 'container'
	},{
        xtype: 'component',
        id : 'exportFrame', 
        autoEl: {
            tag: 'iframe',
            style: 'display:none'
        }
	}],
	launch : function() {
		Ext.getBody().mask('Loading...');
		// indent in excel file
		this.INDENT = 8;
		// maximum number of "OR" clauses in one query 
		this.MAX_OR_CLAUSES = 95;
		// the default csv file name
		this.EXCEL_FILE_NAME = 'timesheet.xls';
		// templates for comboBoxes
		this.COMBOBOX_TEMPLATE = '<tpl for="."><div class="x-boundlist-item">{[values["FormattedID"] + " : " + values["_refObjectName"]]}</div></tpl>';
		this.COMBOBOX_DISPLAY_TEMPLATE = '<tpl for=".">{[values["FormattedID"] + " : " + values["_refObjectName"]]}</tpl>';
		// excel uri
		this.EXCEL_URI = 'data:application/vnd.ms-excel;base64,';
		// excel template
		this.EXCEL_TEMPLATE = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">'+
								'<head><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>worksheet</x:Name><x:WorksheetOptions><x:DisplayGridlines/>' + 
								'</x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><meta charset="utf-8"></head><body style="font-size:11pt">';
		// action object for export
		this.EXPORT_ACTION = {title:"EXPORT", func: this._exportReport};
		// action object for print
		this.PRINT_ACTION = {title:"PRINT", func: this._printReport};
		// output summary report without children
		this.SUMMARY_WITHOUT_CHILDREN = "withoutChildren";
		// output summary report with children
		this.SUMMARY_WITH_CHILDREN = "withChildren";
		// user story list report type
		this.USER_STORY_LIST_TYPE = "userStoryList";
		// time detail report type
		this.TIME_DETAIL_TYPE = "timeDetails";
		// group details by work package
		this.GROUP_BY_WORKPACKAGE = "workpackage";
		// group details by team 
		this.GROUP_BY_TEAM = "team";
		// current report type 
		this.currentReportType = null;
		// current group by type
		this.currentGroupByType = null;
		// object id as key and parent object id as value 
		this.treeMap = new Ext.util.HashMap();
		// object id as key and estimate hours as value
		this.estimateMap = new Ext.util.HashMap();
		// object id as key and To-Do hours as value
		this.toDoMap = new Ext.util.HashMap();
		// object id as key and total time spent hours as value(for all work items)
		this.timeSpentMap = new Ext.util.HashMap();
		// object id as key and total time spent hours as value(for user story and defects only)
		this.artifactTimeSpentMap = new Ext.util.HashMap();
		// all user stories including both epic ones and there children
		this.userStories = [];
		// all user stories and defects
		this.schedulableArtifacts = [];
		// add tasks
		this.tasks = [];
		// user story object id as key and work package name as value
		this.workpackageMap = new Ext.util.HashMap();
		// array of pre-defined object which contains related field values shown in the detailed table
		this.timeEntries = [];
		// array of filtered time entries based on selected work package and/or user story
		this.filteredTimeEntries = [];
		// starting point
		this._addProposalComboBox();
	},

	_addProposalComboBox : function() {
		this.proposalComboBox = Ext.create('Rally.ui.combobox.ComboBox', {
			storeConfig : {
				model : ' PortfolioItem/Proposal',
				autoLoad : true,
				limit : Infinity,
				fetch: ['FormattedID']
			},
			fieldLabel : 'Proposal list:',
			labelAlign : 'right',
			labelWidth : 150,
			width : 600,
			padding : '20 10 5 10',
			tpl : this.COMBOBOX_TEMPLATE,
			displayTpl : this.COMBOBOX_DISPLAY_TEMPLATE,
			editable : false,
			listeners : {
				ready : this._addWorkPackageComboBox,
				select : this._loadWorkPackages,
				scope : this
			}
		});
		this.down('#fieldContainer').add(this.proposalComboBox);
	},
	
	_addWorkPackageComboBox : function() {
		// create work package store
		var proposalCount = this.proposalComboBox.getStore().getCount();
		var selectedProposal;
		if (proposalCount === 0) {
			selectedProposal = null;
		}else{
			selectedProposal = this.proposalComboBox.getRecord().get('_ref');
		}
		this.workpackageStore = Ext.create('Rally.data.wsapi.Store', {
			model : 'Portfolioitem/WorkPackage',
			filters : [ {
				property : 'parent',
				operation : '=',
				value : selectedProposal
			} ],
			fetch: ['FormattedID','Name'],
			autoLoad : true
		});

		// create work package comboBox
		this.workpackageComboBox = Ext.create('Rally.ui.combobox.ComboBox', {
			store : this.workpackageStore,
			fieldLabel : 'Work package list:',
			labelAlign : 'right',
			labelWidth : 150,
			width : 600,
			padding : '5 10 5 10',
			allowNoEntry : true,
			editable : false,
			tpl: this.COMBOBOX_TEMPLATE,
			displayTpl: this.COMBOBOX_DISPLAY_TEMPLATE,
			listeners : {
				ready : this._addUserStoryComboBox,
				select : function(){
					this._getFilteredTimeEntries();
					this._loadEpicUserStories(false);
				},
				scope : this
			}
		});

		// add work package comboBox
		this.down('#fieldContainer').add(this.workpackageComboBox);
	},

	_loadWorkPackages : function() {
		var me = this;
		
		Ext.getBody().mask('Loading...');
		
		// reset filter
		var selectedProposal = this.proposalComboBox.getRecord().get('_ref');
		var filter = {
			property : 'parent',
			operation : '=',
			value : selectedProposal
		};
		this.workpackageStore.setFilter(filter);
		
		// reload store
		this.workpackageStore.load(function() {
			me.workpackageComboBox.setValue(this.getAt(0));
			me._loadEpicUserStories(true);
		});
	},

	_addUserStoryComboBox : function() {
		var me = this;
		
		// create work package store
		var workpackageCount = this.workpackageComboBox.getStore().getCount();
		if (workpackageCount === 0) {
			return;
		}
		me.epicUserStoryStore = Ext.create('Rally.data.wsapi.Store', {
			model : 'UserStory',
			limit : Infinity,
			filters : me._getEpicUserStoryFilter(),
			autoLoad : true
		});

		// create work package comboBox
		me.userStoryComboBox = Ext.create('Rally.ui.combobox.ComboBox', {
			store : me.epicUserStoryStore,
			fieldLabel : 'User story list:',
			labelAlign : 'right',
			labelWidth : 150,
			width : 600,
			padding : '5 10 10 10',
			allowNoEntry : true,
			editable : false,
			tpl: me.COMBOBOX_TEMPLATE,
			displayTpl: me.COMBOBOX_DISPLAY_TEMPLATE,
			
			listeners : {
				ready : me._addStartDatePicker,
				select : function(){
					me._getFilteredTimeEntries();
					me._showReport();
				},
				scope : this
			}
		});

		// add work package comboBox
		this.down('#fieldContainer').add(this.userStoryComboBox);
	},
	
	_loadEpicUserStories : function(loadUserStoryAndTask) {
		var me = this;
		
		Ext.getBody().mask('Loading...');
		var selectedWorkPackge = me.workpackageComboBox.getRecord().get('_ref');
		var filter = this._getEpicUserStoryFilter();
		this.epicUserStoryStore.setFilter(filter);
		this.epicUserStoryStore.load(function() {
			me.userStoryComboBox.setValue(this.getAt(0));
			if(loadUserStoryAndTask){
				me._loadUserStories();
			}else{
				me._getFilteredTimeEntries();
				me._showReport();
			}
		});
	},
	
	_addStartDatePicker : function() {
		var today = new Date();
		var oneYearBefore = new Date();
		oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
		var twoWeeksBefore = new Date();
		twoWeeksBefore.setDate(twoWeeksBefore.getDate()-14);
		this.startDatePicker = Ext.create('Rally.ui.DateField', {
			fieldLabel : 'Start date:',
			labelAlign : 'right',
			labelWidth : 150,
			padding : '5 10 10 10',
			value : twoWeeksBefore,
			minValue : oneYearBefore,
			maxValue : today,
			editable : false,
			listeners : {
				afterRender : this._addEndDatePicker,
				select : this._loadTimeSheetData,
				scope : this
			}
		});
		this.down('#fieldContainer').add(this.startDatePicker);
	},

	_addEndDatePicker : function() {
		var today = new Date();
		var oneYearBefore = new Date();
		oneYearBefore.setFullYear(today.getFullYear() - 1);
		this.endDatePicker = Ext.create('Rally.ui.DateField', {
			fieldLabel : 'End date:',
			labelAlign : 'right',
			padding : '5 10 10 10',
			labelWidth : 150,
			value : today,
			minValue : oneYearBefore,
			maxValue : today,
			editable : false,
			listeners : {
				afterRender : this._addReportRadioButtons,
				select : this._loadTimeSheetData,
				scope : this
			}
		});
		this.down('#fieldContainer').add(this.endDatePicker);
	},
	
	_addReportRadioButtons : function(){
		var me = this;
		me.currentReportType = me.USER_STORY_LIST_TYPE;
		me.reportRadioButtonPanel = Ext.create('Ext.container.Container', {
			height: 30,
			width: 400,
			layout: {
				align: 'stretch',
				type: 'vbox'
			},
			defaults: { 
				labelWidth: 150
			},
			items: [{
					xtype: 'radiogroup',
                    fieldLabel: 'Report type:',
                    labelAlign : 'right',
                    itemId : 'reportType',
                    columns: 2,
                    items: [
                        {
                            xtype: 'radiofield',
                            boxLabel: 'User story list',
                            name : 'type',
                            checked: true,
                            inputValue: me.USER_STORY_LIST_TYPE
                        },
                        {
                            xtype: 'radiofield',
                            boxLabel: 'Timesheet report',
                            name : 'type',
                            inputValue: me.TIME_DETAIL_TYPE
                        }
                    ],
                    listeners : {
                        change : me._showReport,
                        scope : me
                    }
                }],
            listeners : {
				afterRender : me._addExportButton,
				scope : me
			}
		});
		me.down('#fieldContainer').add(me.reportRadioButtonPanel);
	},
	
	_addGroupRadioButtons : function(){
		var me =this;
		me.currentGroupByType = me.GROUP_BY_WORKPACKAGE;
		me.groupRadioButtonPanel = Ext.create('Ext.container.Container', {
			height: 30,
			width: 400,
			itemId : 'groupRadioButton',
			layout: {
				align: 'stretch',
				type: 'vbox'
			},
			defaults: { 
				labelWidth: 150
			},
			items: [{
					xtype: 'radiogroup',
                    fieldLabel: 'Group by',
                    labelAlign : 'right',
                    itemId : 'groupType',
                    columns: 2,
                    items: [
                        {
                            xtype: 'radiofield',
                            boxLabel: 'Work package',
                            name : 'group',
                            checked: true,
                            inputValue: me.GROUP_BY_WORKPACKAGE
                        },
                        {
                            xtype: 'radiofield',
                            boxLabel: 'Team',
                            name : 'group',
                            inputValue: me.GROUP_BY_TEAM
                        }
                    ],
                    listeners : {
                        change : me._refreshDetailedTable,
                        scope : me
                    }
                }],
            listeners : {
				afterRender : me._refreshDetailedTable,
				scope : me
			}
		});
		me.down('#fieldContainer').add(me.groupRadioButtonPanel);
	},
	
	_addExportButton : function(){
		var me = this;
		me.exportButton = Ext.create('Ext.Button', {
			text: 'Export to Excel...',
			listeners : {
				afterRender : this._addPrintButton,
				scope : this
			},
			handler: function() {
				if(me.currentReportType == me.USER_STORY_LIST_TYPE){
					me._showDialog(me.EXPORT_ACTION);
				}else{
					me._exportReport(false);
				}
			}	
		});
		this.down('#buttonContainer').add(this.exportButton);
	},
	
	_addPrintButton : function(){
		var me = this;
		me.printButton = Ext.create('Ext.Button', {
			text: 'Print...',
			margin : '0 0 0 15',
			listeners : {
				afterRender : this._loadUserStories,
				scope : this
			},
			handler: function() {
				if(me.currentReportType == me.USER_STORY_LIST_TYPE){
					me._showDialog(me.PRINT_ACTION);
				}else{
					me._printReport(false);
				}
            }  
		});
		this.down('#buttonContainer').add(this.printButton);
	},
	
	_loadUserStories : function() {
		var me = this;
		var selectedWorkPackge = this.workpackageComboBox.getRecord().get('_ref');
		me.userStoryStore = Ext.create('Rally.data.wsapi.Store', {
			model : 'UserStory',
			fetch: ['tasks','defects','ObjectID','Parent','DirectChildrenCount','TaskEstimateTotal','TaskRemainingTotal','FormattedID','Children','WorkPackage','Name','Project','Owner','ScheduleState','PlanEstimate','DisplayName'],
			filters : me._getUserStoryFilter(),
			autoLoad : true,
			limit : Infinity,
			listeners : {
				load : function(userStoryStore, data) {
					me.tasks =[];
					me.userStories = [];
					me.schedulableArtifacts = [];
					me.treeMap.clear();
					me.estimateMap.clear();
					me.toDoMap.clear();
					me.workpackageMap.clear();
					if(data && data.length > 0){
						// put user stories in the array
						data.forEach(function(userStory){
							var userStoryID = userStory.get('ObjectID');
							me.estimateMap.add(userStoryID, userStory.get('TaskEstimateTotal'));
							me.toDoMap.add(userStoryID, userStory.get('TaskRemainingTotal'));
							if(userStory.get('Parent')){
								me.treeMap.add(userStoryID, userStory.get('Parent').ObjectID);
							}
							me.userStories.push(userStory);
							me.schedulableArtifacts.push(userStory);
							me.workpackageMap.add(userStoryID, userStory.get('WorkPackage'));
						});
						// load defects
						me.currentArtifactIndex = 0;
						me._loadDefects();
					}else{
						me._loadTimeSheetData();
					}
				}
			}
		});
	},
	
	_loadDefects : function(){
		var me = this;
		if(me.userStories.length === 0){
			// load tasks then
			me._loadTasks();
			return;
		}
		var defectCount, userStory, userStoryID, filter, allFilter;
		for(var i=0; i< me.MAX_OR_CLAUSES;i++){
			userStory = me.userStories.shift();
			defectCount = userStory.get('Defects').Count;
			if(defectCount > 0){
				userStoryID = userStory.get('ObjectID');
				filter = Ext.create('Rally.data.QueryFilter', {
					property: 'Requirement.ObjectID',
					operator: '=',
					value: userStoryID
				});
				if(!allFilter){
					allFilter = filter;
				}else{
					allFilter = allFilter.or(filter);
				}
			}
			if(me.userStories.length === 0){
				break;
			}
		}

		if(allFilter){
			Ext.create('Rally.data.wsapi.Store', {
				model : 'Defect',
				fetch: ['tasks','ObjectID', 'Requirement','DirectChildrenCount','TaskEstimateTotal','TaskRemainingTotal','FormattedID','Name'],
				filters : allFilter,
				autoLoad : true,
				limit : Infinity,
				listeners: {
					load : function(store, data){
						var defectId;
						if(data && data.length > 0){
							_.each(data, function(value){
								defectId = value.get('ObjectID');
								me.estimateMap.add(defectId, value.get('TaskEstimateTotal'));
								me.toDoMap.add(defectId, value.get('TaskRemainingTotal'));
								if(value.get('Requirement')){
									me.treeMap.add(defectId, value.get('Requirement').ObjectID);
								}
								me.schedulableArtifacts.push(value);
								me.workpackageMap.add(defectId, me.workpackageMap.get(value.get('Requirement').ObjectID));
							});
						}
						me._loadDefects();
					}
				}
			});
		}else{
			me._loadDefects();
		}
	},
	
	_loadTasks : function(){
		var me = this;
		
		if(me.currentArtifactIndex == me.schedulableArtifacts.length){
			me._loadTimeSheetData();
			return;
		}
		
		var taskCount, userStoryID, schedulableArtifact, filter, allFilter;
		for(var i=0; i< me.MAX_OR_CLAUSES;i++){
			schedulableArtifact = me.schedulableArtifacts[me.currentArtifactIndex];
			taskCount = schedulableArtifact.get('Tasks').Count;
			var schedulableArtifactID = schedulableArtifact.get('ObjectID');
			if(taskCount > 0){
				filter = Ext.create('Rally.data.QueryFilter', {
					property: 'WorkProduct.ObjectID',
					operator: '=',
					value: schedulableArtifactID
				});
				if(!allFilter){
					allFilter = filter;
				}else{
					allFilter = allFilter.or(filter);
				}
			}
			me.currentArtifactIndex++;
			if(me.currentArtifactIndex === me.schedulableArtifacts.length){
				break;
			}
		}
		
		if(allFilter){
			Ext.create('Rally.data.wsapi.Store', {
				model : 'Task',
				filters : allFilter,
				autoLoad : true,
				limit : Infinity,
				listeners: {
					load : function(store, data){
						var taskId;
						if(data && data.length > 0){
							_.each(data, function(value){
								taskId = value.get('ObjectID');
								me.treeMap.add(taskId, value.get('WorkProduct').ObjectID);
								me.tasks.push(value);
							});
						}
						me._loadTasks();
					}
				}
			});
		}else{
			me._loadTasks();
		}
	},
	
	_loadTimeSheetData : function(){
		Ext.getBody().mask('Loading...');
		var me = this;
		// reset time entry data
		me.timeSpentMap.clear();
		me.artifactTimeSpentMap.clear();
		me.timeEntries = [];
		// load time entries against user story or defect
		me.currentArtifactIndex = 0;
		me._loadTimeEntriesByArtifact();
	},
	
	_loadTimeEntriesByArtifact : function(){
		var me = this;
		// skip time entry query and calculation if all user stories and defects have been processed
		if(me.currentArtifactIndex == me.schedulableArtifacts.length){
			// skip time entry query and calculation if no task is found
			if(me.tasks.length === 0){
				me._showReport();
			}else{
				// load time entries against task
				me.currentTaskIndex = 0;
				me._loadTimeEntriesByTask();
			}
			return;
		}
		var artifact, artifactId, artifactIdFilter, allFilter;
		
		// add filters against start/end date
		allFilter = (Ext.create('Rally.data.QueryFilter', {
			property: 'DateVal',
			operator: '>=',
			value: me._toISOString(me.startDatePicker.getValue())
		})).and(Ext.create('Rally.data.QueryFilter', {
			property: 'DateVal',
			operator: '<=',
			value: me._toISOString(me.endDatePicker.getValue())
		})).and(Ext.create('Rally.data.QueryFilter', {
			property: 'TimeEntryItem.Task',
			operator: '=',
			value: null
		})).and(Ext.create('Rally.data.QueryFilter', {
			property: 'TimeEntryItem.WorkProduct',
			operator: '!=',
			value: null
		})).and(Ext.create('Rally.data.QueryFilter', {
			property: 'Hours',
			operator: '>',
			value: 0
		}));
		
		// assemble filters against task id
		for(var i=0; i< me.MAX_OR_CLAUSES;i++){
			artifact = me.schedulableArtifacts[me.currentArtifactIndex];
			artifactId = artifact.get('ObjectID');
			if(!artifactIdFilter){
				artifactIdFilter = Ext.create('Rally.data.QueryFilter', {
					property: 'TimeEntryItem.WorkProduct.ObjectID',
					operator: '=',
					value: artifactId
				});
			}else{
				artifactIdFilter = artifactIdFilter.or(Ext.create('Rally.data.QueryFilter', {
					property: 'TimeEntryItem.WorkProduct.ObjectID',
					operator: '=',
					value: artifactId
				}));
			}
			me.currentArtifactIndex++;
			if(me.currentArtifactIndex == me.schedulableArtifacts.length){
				break;
			}
		}

		allFilter = allFilter.and(artifactIdFilter);
		Ext.create('Rally.data.wsapi.Store', {
			model : 'TimeEntryValue',
			filters : allFilter,
			fetch : ['ObjectID', 'Hours', 'DateVal','TimeEntryItem', 'Project', 'FormattedID','WorkProduct','User','Name', 'DisplayName'],
			limit : Infinity,
			autoLoad : true,
			listeners: {
				load : function(store, data){
					if(data && data.length >0){
						var timeEntryItem, workpackage, detail;
						_.each(data, function(value){
							timeEntryItem = value.get('TimeEntryItem');
							workpackage = me.workpackageMap.get(timeEntryItem.WorkProduct.ObjectID);
							// assemble detail data
							detail = {
								workpackageID : workpackage.ObjectID,
								workpackageName : workpackage.FormattedID + " : "+ workpackage.Name, 
								teamID : timeEntryItem.Project.ObjectID,
								teamName :  timeEntryItem.Project.Name,
								userStoryID : me._getRootParentID(timeEntryItem.WorkProduct.ObjectID),
								who : timeEntryItem.User.DisplayName,
								workItem : timeEntryItem.WorkProduct.FormattedID + " : " +timeEntryItem.WorkProduct.Name,
								date : value.get('DateVal'),
								hours : value.get('Hours') 
							};
							me.timeEntries.push(detail);
							me._setTimeSpentByObjectId(timeEntryItem.WorkProduct.ObjectID, value.get('Hours'));
							me._setArtifactTimeSpentByObjectId(timeEntryItem.WorkProduct.ObjectID, value.get('Hours'));
						});
					}
					me._loadTimeEntriesByArtifact();
				}
			}
		});
	},
	
	_loadTimeEntriesByTask : function(){
		var me = this;

		// skip time entry query and calculation if all tasks have been processed
		if(me.currentTaskIndex == me.tasks.length){
			me.filteredTimeEntries = me.timeEntries;
			me._showReport();
			return;
		}
		var taskId, task, taskIdFilter, allFilter;
		
		// add filters against start/end date
		allFilter = (Ext.create('Rally.data.QueryFilter', {
			property: 'DateVal',
			operator: '>=',
			value: me._toISOString(me.startDatePicker.getValue())
		})).and(Ext.create('Rally.data.QueryFilter', {
			property: 'DateVal',
			operator: '<=',
			value: me._toISOString(me.endDatePicker.getValue())
		})).and(Ext.create('Rally.data.QueryFilter', {
			property: 'TimeEntryItem.Task',
			operator: '!=',
			value: null
		})).and(Ext.create('Rally.data.QueryFilter', {
			property: 'Hours',
			operator: '>',
			value: 0
		}));
		
		// assemble filters against task id
		for(var i=0; i< me.MAX_OR_CLAUSES;i++){
			task = me.tasks[me.currentTaskIndex];
			taskId = task.get('ObjectID');
			me.estimateMap.add(taskId, task.get('Estimate'));
			me.toDoMap.add(taskId, task.get('ToDo'));
			if(!taskIdFilter){
				taskIdFilter = Ext.create('Rally.data.QueryFilter', {
					property: 'TimeEntryItem.Task.ObjectID',
					operator: '=',
					value: taskId
				});
			}else{
				taskIdFilter = taskIdFilter.or(Ext.create('Rally.data.QueryFilter', {
					property: 'TimeEntryItem.Task.ObjectID',
					operator: '=',
					value: taskId
				}));
			}
			me.currentTaskIndex++;
			if(me.currentTaskIndex == me.tasks.length){
				break;
			}
		}

		allFilter = allFilter.and(taskIdFilter);

		Ext.create('Rally.data.wsapi.Store', {
			model : 'TimeEntryValue',
			filters : allFilter,
			fetch : ['ObjectID', 'Hours', 'DateVal','TimeEntryItem', 'Project', 'Task', 'FormattedID','WorkProduct','User','Name', 'DisplayName'],
			limit : Infinity,
			autoLoad : true,
			listeners: {
				load : function(store, data){
					if(data && data.length >0){
						var timeEntryItem, workpackage, detail;
						_.each(data, function(value){
							timeEntryItem = value.get('TimeEntryItem');
							workpackage = me.workpackageMap.get(timeEntryItem.Task.WorkProduct.ObjectID);
							// assemble detail data
							detail = {
								workpackageID : workpackage.ObjectID,
								workpackageName : workpackage.FormattedID + " : "+ workpackage.Name, 
								teamID : timeEntryItem.Project.ObjectID,
								teamName :  timeEntryItem.Project.Name,
								userStoryID : me._getRootParentID(timeEntryItem.Task.ObjectID),
								who : timeEntryItem.User.DisplayName,
								workItem : timeEntryItem.Task.FormattedID + " : " + timeEntryItem.Task.Name,
								date : value.get('DateVal'),
								hours : value.get('Hours') 
							};
							me.timeEntries.push(detail);
							me._setTimeSpentByObjectId(timeEntryItem.Task.ObjectID, value.get('Hours'));
						});
					}
					me._loadTimeEntriesByTask();
				}
			}
		});
	},
	
	_setTimeSpentByObjectId : function(objectId, hours){
		if(this.timeSpentMap.get(objectId)){
			this.timeSpentMap.add(objectId, this._roundFloatNumber(this.timeSpentMap.get(objectId) + hours));
		}else{
			this.timeSpentMap.add(objectId, hours);
		}
		var parentId = this.treeMap.get(objectId);
		if(parentId){
			this._setTimeSpentByObjectId(parentId,hours);
		}
	},
	
	_setArtifactTimeSpentByObjectId : function(objectId, hours){
		if(this.artifactTimeSpentMap.get(objectId)){
			this.artifactTimeSpentMap.add(objectId, this._roundFloatNumber(this.artifactTimeSpentMap.get(objectId) + hours));
		}else{
			this.artifactTimeSpentMap.add(objectId, hours);
		}
	},
	
	_getFilteredTimeEntries : function(){
		var me = this;
		var selectedWorkpackageID = me.workpackageComboBox.getRecord().get("ObjectID");
		var selectedUserStoryID = me.userStoryComboBox.getRecord().get('ObjectID');
		if(!selectedWorkpackageID && !selectedUserStoryID){
			me.filteredTimeEntries = me.timeEntries;
		}else{
			me.filteredTimeEntries = [];
			_.each(me.timeEntries, function(timeEntry){
				if(selectedWorkpackageID && selectedWorkpackageID != timeEntry.workpackageID){
					return;
				}
				if(selectedUserStoryID && selectedUserStoryID != timeEntry.userStoryID){
					return;
				}	
				me.filteredTimeEntries.push(timeEntry);
			});
		}
	},
	
	_showReport : function(obj, newValue){
		Ext.getBody().mask('Loading...');

		var me= this;
		if(newValue){
			me.currentReportType = newValue.type;
		}
		Ext.ComponentQuery.query('#gridContainer')[0].remove(Ext.ComponentQuery.query('#timesheet')[0], true);
		Ext.ComponentQuery.query('#tableContainer')[0].remove(Ext.ComponentQuery.query('#detailedTable')[0], true);
		
		if(me.currentReportType == me.USER_STORY_LIST_TYPE){
			if(me.currentGroupByType){
				me.groupRadioButtonPanel.setVisible(false);
			}
			me._buildTreeStore();
			
		}else if(me.currentReportType == me.TIME_DETAIL_TYPE){
			if(me.currentGroupByType){
				me.groupRadioButtonPanel.setVisible(true);
				me._addDetailedTable();
			}else{
				me._addGroupRadioButtons();
			}
		}else{
			//should never get here
		}
	},

	_buildTreeStore : function() {
		var me = this;
		Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
			models : [ 'userstory' ],
			filters : me._getTreeUserStoryFilter(),
			sorters : [{
					property: 'FormattedID',
					direction: 'ASC'
				}],
			autoLoad : true,
			enableHierarchy : true,
			pageSize: 20
		}).then({
			success : me._addTimesheet,
			scope : me
		});
	},

	_addTimesheet : function(store) {
		var me = this;
		
		me.timesheet = Ext.create('Rally.ui.grid.TreeGrid', {
			itemId : 'timesheet',
			store : store,
			enableEditing : false,
			pagingToolbarCfg :{
				pageSizes: [20, 50, 100]
			},
			enableScheduleStateClickable : false,
			enableColumnMove : false,
			enableBulkEdit : false,
			enableBlockedReasonPopover : false,
			enableColumnHide : false,
			columnCfgs : [ "FormattedId", "Name", 'Project', 'Owner', 
			{
				text : 'State',
				dataIndex : "ScheduleState"
			}, {
				text : 'US/DE Plan Estimate',
				dataIndex : "PlanEstimate",
				renderer : function(v, m, r) {
					return me._processNumberValue(v,true);
				}
			}, {
				text : 'Task Estimate',
				dataIndex : "TaskEstimateTotal",
				renderer : function(v, m, r) {
					return me._processNumberValue(me.estimateMap.get(r.get('ObjectID')),true);
				}
			}, {
				text : 'Task To Do',
				dataIndex : "TaskRemainingTotal",
				renderer : function(v, m, r) {
					return me._processNumberValue(me.toDoMap.get(r.get('ObjectID')),true);
				}
			}, {
				text : 'Time Spent',
				dataIndex : "TaskRemainingTotal",
				renderer : function(v, m, r) {
					if(r.get("_type") == "task"){
						return me._processNumberValue(me.timeSpentMap.get(r.get('ObjectID')),true);
					}else{
						return me._processNumberValue(me.artifactTimeSpentMap.get(r.get('ObjectID')),true);
					}
				}
			}, {
				text : 'Time Spent Total',
				dataIndex : "TaskRemainingTotal",
				renderer : function(v, m, r) {
					if(r.get("_type") == "hierarchicalrequirement" && !r.get("Parent")){
						return me._processNumberValue(me.timeSpentMap.get(r.get('ObjectID')),true);
					}else{
						return '';
					}
				}
			},{
				text : 'Outstanding(Plan Est less Spent)',
				dataIndex : "PlanEstimate",
				renderer : function(v, m, r) {
					if(r.get("_type") != "hierarchicalrequirement" || r.get('Parent') || !v || !me.timeSpentMap.get(r.get('ObjectID'))){
						return '';
					}else{
						return me._roundFloatNumber(v - me.timeSpentMap.get(r.get('ObjectID')));
					}
				}
			} ],
			listeners: {
				scope : me
			}
		});
		
		// add time sheet grid
		me.down('#gridContainer').add(me.timesheet);
		
		me._generateSummaryRowMap();
		
		Ext.getBody().unmask();
	},
	
	_refreshDetailedTable : function(obj, newValue){
		Ext.getBody().mask('Loading...');
		Ext.ComponentQuery.query('#tableContainer')[0].remove(Ext.ComponentQuery.query('#detailedTable')[0], true);
		if(newValue.group){
			this.currentGroupByType = newValue.group;
		}
		var me = this;
		Ext.Function.defer(function() {
			me._addDetailedTable();
		}, 10);
	},
	
	_addDetailedTable : function(){
		var me = this;
		me.table = Ext.create('Ext.panel.Panel', {
			id : 'detailedDiv',
			itemId : 'detailedTable',
			layout: {
				type: 'table',
				tableAttrs: {
					cellspacing: 0,
					cellpadding: 0
				},
				columns: 6
			},
			defaults: {
				height : 20
			},
			items: me._getTableItems()
		});
		
		me.down('#tableContainer').add(me.table);
		
		Ext.getBody().unmask();
	},
	
	_getTableItems : function(){
		var me = this;
		if(me.currentGroupByType == me.GROUP_BY_WORKPACKAGE){
			me._sortTimeEntriesByWorkPackage();
			return me._getTableByWorkPackage();
		}else if(me.currentGroupByType == me.GROUP_BY_TEAM){
			me._sortTimeEntriesByTeam();
			return me._getTableByTeam();
		}else{
			// should never get here 
			return []; 
		}
	},
	
	_getTableByWorkPackage : function(){
		var me = this;
		
		//header row
		var rows = [
            {
				html : "Work Package",
				cellCls : 'headerCol'
			}, {
				html : "Team",
				cellCls : 'headerCol'
			}, {
				html : "Who",
				cellCls : 'headerCol'
			}, {
				html : "Work Item",
				cellCls : 'headerCol'
			}, {
				html : "Date",
				cellCls : 'headerCol'
			}, {
				html : "Hours",
				cellCls : 'headerCol lastCol'
			} 
		];
		// do nothing if there is no time entry
		if(me.timeEntries.length === 0){
			me._generateDetailContent(rows);
			return rows;
		}
		var selectedWorkpackageID = me.workpackageComboBox.getRecord().get("ObjectID");
		var selectedUserStoryID = me.userStoryComboBox.getRecord().get('ObjectID');
		var currentWorkpackageID, currentWorkpackageName, currentTeamName, currentUserName;
		var currentWorkpackageRows, currentTeamRows, currentUserRows, currentItemRows;
		var packageSumHours, userSumHours, proposalSumHours;
		var workpackageCount, teamCount, userCount;
		var workPackageName, teamName, who;
		var index, item;
		
		index = 0;
		proposalSumHours = 0;
		while(true){
			if(currentWorkpackageName && (index == me.filteredTimeEntries.length || currentWorkpackageName != me.filteredTimeEntries[index].workpackageName)){
				// set workpackage count
				me._setItemCount(workpackageCount, currentWorkpackageRows);
				// set team count
				me._setItemCount(teamCount,currentTeamRows,currentWorkpackageRows);
				// set user count
				me._setItemCount(userCount, currentUserRows, currentTeamRows,currentWorkpackageRows);
				// add rows
				rows = rows.concat(currentWorkpackageRows, currentTeamRows, currentUserRows, currentItemRows);
				rows = rows.concat(me._getSummaryRow(currentUserName, 2, userSumHours), me._getSummaryRow(currentWorkpackageName, 4, packageSumHours));
			}
			if(index == me.filteredTimeEntries.length)
				break;
			
			item = me.filteredTimeEntries[index];
			if(currentWorkpackageName != item.workpackageName){// start with a new work package
				// reset rows
				currentWorkpackageRows = [];
				me._setItemRowByWorkpackage(currentWorkpackageRows, item, true, true, true);
				currentTeamRows = [];
				currentUserRows =[];
				currentItemRows = [];
				// reset counts
				workpackageCount = 2;
				teamCount = 1;
				userCount = 1;
				// reset sum hours
				packageSumHours = 0;
				userSumHours = 0;
				// reset current values
				currentWorkpackageName = item.workpackageName;
				currentTeamName = item.teamName;
				currentUserName = item.who;
			}else if(currentTeamName != item.teamName){// start with a new team
				// set team count
				me._setItemCount(teamCount,currentTeamRows,currentWorkpackageRows);
				// set user count
				me._setItemCount(userCount, currentUserRows, currentTeamRows,currentWorkpackageRows);
				// reset rows
				currentWorkpackageRows = currentWorkpackageRows.concat(currentTeamRows, currentUserRows, currentItemRows, me._getSummaryRow(currentUserName, 2, userSumHours));
				currentTeamRows = [];
				me._setItemRowByWorkpackage(currentTeamRows, item, false, true, true);
				currentUserRows =[];
				currentItemRows = [];
				// reset counts
				teamCount = 1;
				userCount = 1;
				workpackageCount++;
				// reset sum hours
				userSumHours = 0;
				// reset current values
				currentTeamName = item.teamName;
				currentUserName = item.who;
			}else if(currentUserName != item.who){// start with a new user
				// set user count
				me._setItemCount(userCount, currentUserRows, currentTeamRows,currentWorkpackageRows);
				// reset rows
				currentTeamRows = currentTeamRows.concat(currentUserRows, currentItemRows, me._getSummaryRow(currentUserName, 2, userSumHours));
				currentUserRows = [];
				me._setItemRowByWorkpackage(currentUserRows, item, false, false, true);
				currentItemRows = [];
				// reset counts
				userCount = 1;
				teamCount++;
				workpackageCount++;
				// reset sum hours
				userSumHours = 0;
				// reset user name
				currentUserName = item.who;
			}else{
				me._setItemRowByWorkpackage(currentItemRows, item, false, false, false);
			}
			
			workpackageCount++;
			teamCount++;
			userCount++;
			packageSumHours = me._roundFloatNumber(packageSumHours + item.hours);
			userSumHours  = me._roundFloatNumber(userSumHours + item.hours);
			proposalSumHours = me._roundFloatNumber(proposalSumHours + item.hours);

			index++;
		}
		
		// show proposal summary row only if no specific work package or user story is selected
		if(!selectedWorkpackageID && !selectedUserStoryID){
			rows = rows.concat(me._getSummaryRow(this.proposalComboBox.getRawValue(), 5, proposalSumHours));
		}
		
		me._generateDetailContent(rows);
		return rows;
	},
	
	_getTableByTeam : function(){
		var me = this;
		
		//header row
		var rows = [
            {
				html : "Team",
				cellCls : 'headerCol'
			}, {
				html : "Work Package",
				cellCls : 'headerCol'
			}, {
				html : "Who",
				cellCls : 'headerCol'
			}, {
				html : "Work Item",
				cellCls : 'headerCol'
			}, {
				html : "Date",
				cellCls : 'headerCol'
			}, {
				html : "Hours",
				cellCls : 'headerCol lastCol'
			} 
		];
		// do nothing if there is no time entry
		if(me.timeEntries.length === 0){
			me._generateDetailContent(rows);
			return rows;
		}
		var selectedWorkpackageID = me.workpackageComboBox.getRecord().get("ObjectID");
		var selectedUserStoryID = me.userStoryComboBox.getRecord().get('ObjectID');
		var currentWorkpackageID, currentWorkpackageName, currentTeamName, currentUserName;
		var currentWorkpackageRows, currentTeamRows, currentUserRows, currentItemRows;
		var teamSumHours, userSumHours, proposalSumHours;
		var workpackageCount, teamCount, userCount;
		var workPackageName, teamName, who;
		var index, item;
		index = 0;
		proposalSumHours = 0;
		while(true){
			if(currentTeamName && (index == me.filteredTimeEntries.length || currentTeamName != me.filteredTimeEntries[index].teamName)){
				// set team count
				me._setItemCount(teamCount, currentTeamRows);
				// set workpackage count
				me._setItemCount(workpackageCount, currentWorkpackageRows, currentTeamRows);
				// set user count
				me._setItemCount(userCount, currentUserRows, currentWorkpackageRows, currentTeamRows);
				// add rows
				rows = rows.concat(currentTeamRows, currentWorkpackageRows, currentUserRows, currentItemRows);
				rows = rows.concat(me._getSummaryRow(currentUserName, 2, userSumHours), me._getSummaryRow(currentTeamName, 4, teamSumHours));
			}
			if(index == me.filteredTimeEntries.length)
				break;
			
			item = me.filteredTimeEntries[index];
			
			if(currentTeamName != item.teamName){// start with a new team
				// reset rows
				currentTeamRows = [];
				me._setItemRowByTeam(currentTeamRows, item, true, true, true);
				currentWorkpackageRows = [];
				currentUserRows =[];
				currentItemRows = [];
				// reset counts
				teamCount = 2;
				workpackageCount = 1;
				userCount = 1;
				// reset sum hours
				teamSumHours = 0;
				userSumHours = 0;
				// reset current values
				currentTeamName = item.teamName;
				currentWorkpackageName = item.workpackageName;
				currentUserName = item.who;
			}else if(currentWorkpackageName != item.workpackageName){// start with a new work package
				// set workpackage count
				me._setItemCount(workpackageCount, currentWorkpackageRows, currentTeamRows);
				// set user count
				me._setItemCount(userCount, currentUserRows, currentWorkpackageRows, currentTeamRows);
				// reset rows
				currentTeamRows = currentTeamRows.concat(currentWorkpackageRows, currentUserRows, currentItemRows, me._getSummaryRow(currentUserName, 2, userSumHours));
				currentWorkpackageRows = [];
				me._setItemRowByTeam(currentWorkpackageRows, item, false, true, true);
				currentUserRows =[];
				currentItemRows = [];
				// reset counts
				workpackageCount = 1;
				userCount = 1;
				teamCount++;
				// reset sum hours
				userSumHours = 0;
				// reset current values
				currentWorkpackageName = item.workpackageName;
				currentUserName = item.who;
			}else if(currentUserName != item.who){// start with a new user
				// set user count
				me._setItemCount(userCount, currentUserRows, currentWorkpackageRows, currentTeamRows);
				// reset rows
				currentWorkpackageRows = currentWorkpackageRows.concat(currentUserRows, currentItemRows, me._getSummaryRow(currentUserName, 2, userSumHours));
				currentUserRows = [];
				me._setItemRowByTeam(currentUserRows, item, false, false, true);
				currentItemRows = [];
				// reset counts
				userCount = 1;
				workpackageCount++;
				teamCount++;
				// reset sum hours
				userSumHours = 0;
				// reset user name
				currentUserName = item.who;
			}else{
				me._setItemRowByTeam(currentItemRows, item, false, false, false);
			}
			
			teamCount++;
			workpackageCount++;
			userCount++;
			teamSumHours = me._roundFloatNumber(teamSumHours + item.hours);
			userSumHours = me._roundFloatNumber(userSumHours + item.hours);
			proposalSumHours = me._roundFloatNumber(proposalSumHours + item.hours);

			index++;
		}
		// show proposal summary row only if no specific work package or user story is selected
		if(!selectedWorkpackageID && !selectedUserStoryID){
			rows = rows.concat(me._getSummaryRow(this.proposalComboBox.getRawValue(), 5, proposalSumHours));
		}
		
		me._generateDetailContent(rows);
		return rows;
	},
	
	_getSummaryRow :function(groupName, colspan, groupSumHours){
		return [{
			html : groupName + " Total",
			colspan : colspan,
			cellCls  : 'totalCol'
		},{
			html : groupSumHours,
			cellCls : "lastCol"
		}];
	},
	
	_setItemCount : function(count, rows1, rows2, rows3){
		if(rows3){
			if(rows1.length > 0){
				rows1[0].rowspan = count;
			}else if(rows2.length > 0 && rows2[1].cellCls == 'groupCol'){
				rows2[1].rowspan = count;
			}else{
				rows3[2].rowspan = count;
			}
		}else if(rows2){
			if(rows1.length > 0 && rows1[1].cellCls == 'groupCol'){
				rows1[0].rowspan = count;
			}else{
				rows2[1].rowspan = count;
			}
		}else{
			rows1[0].rowspan = count;
		}
		
	},
	
	_setItemRowByWorkpackage : function(rows, item, includeWorkpackage, includeTeam, includeUser){
		if(includeWorkpackage){
			rows.push({html : item.workpackageName,
					rowspan : 1,
					cellCls  : 'groupCol'
			});
		}
		if(includeTeam){
			rows.push({html : item.teamName,
					rowspan : 1,
					cellCls  : 'groupCol'
			});
		}
		if(includeUser){
			rows.push({html : item.who,
					rowspan : 1,
					cellCls  : 'groupCol'
			});
		}
		rows.push({
			html : item.workItem
		},{
			html : Ext.Date.format(item.date,'d/m/Y')
		},{
			html : item.hours,
			cellCls : "lastCol"
		});
	},
	
	_setItemRowByTeam : function(rows, item, includeTeam, includeWorkpackage, includeUser){
		if(includeTeam){
			rows.push({html : item.teamName,
					rowspan : 1,
					cellCls  : 'groupCol'
			});
		}
		if(includeWorkpackage){
			rows.push({html : item.workpackageName,
					rowspan : 1,
					cellCls  : 'groupCol'
			});
		}
		if(includeUser){
			rows.push({html : item.who,
					rowspan : 1,
					cellCls  : 'groupCol'
			});
		}
		rows.push({
			html : item.workItem
		},{
			html : Ext.Date.format(item.date,'d/m/Y')
		},{
			html : item.hours,
			cellCls : "lastCol"
		});
	},
	
	_sortTimeEntriesByWorkPackage : function(){
		var me = this;
		Ext.Array.sort(this.timeEntries,(function(a, b){
			if ( a.workpackageName < b.workpackageName )
				return -1;
			if ( a.workpackageName > b.workpackageName )
				return 1;
			if ( a.teamName < b.teamName )
				return -1;
			if ( a.teamName > b.teamName )
				return 1;
			if ( a.who < b.who )
				return -1;
			if ( a.who > b.who )
				return 1;
			if ( a.workItem < b.workItem )
				return -1;
			if ( a.workItem > b.workItem )
				return 1;
			if ( a.date < b.date )
				return -1;
			if ( a.date > b.date )
				return 1;
			return 0;
		}));
	},
	
	_sortTimeEntriesByTeam : function(){
		Ext.Array.sort(this.timeEntries,(function(a, b){
			if ( a.teamName < b.teamName )
				return -1;
			if ( a.teamName > b.teamName )
				return 1;
			if ( a.workpackageName < b.workpackageName )
				return -1;
			if ( a.workpackageName > b.workpackageName )
				return 1;
			if ( a.who < b.who )
				return -1;
			if ( a.who > b.who )
				return 1;
			if ( a.workItem < b.workItem )
				return -1;
			if ( a.workItem > b.workItem )
				return 1;
			if ( a.date < b.date )
				return -1;
			if ( a.date > b.date )
				return 1;
			return 0;
		}));
	},
	
	_getRootParentID : function(objectID){
		var parentID = this.treeMap.get(objectID);
		if(!parentID){
			return objectID;
		}else{
			return this._getRootParentID(parentID);	
		}
	},
	
	_showDialog : function(action){
		var me = this;
		me.dialog = Ext.create('Rally.ui.dialog.Dialog', {
			autoShow: false,
			draggable: true,
			closable : true,
			autoDestroy: true,
			closeAction: 'hide',
			title: action.title,
			listeners : {
				scope : me
			},
			items: [{
				xtype: 'component',
				html: 'What would you like to ' + action.title.toLowerCase() + "?",
				padding: '20 0 20 20',
				style: 'label{align:left;font-size:15px; font-weight:bold;}'
			},
			{
				xtype: 'container',
				width: 500,
				padding: '20 10 20 10',
				margin: '0 20 40 20',
				border: 1,
				style: {
					borderColor: 'lightgrey',
					borderStyle: 'solid'
				},
				items:[{
					xtype: 'radiogroup',
					itemId : 'summaryType',
					columns: 1,
					items: [{
						xtype: 'radiofield',
						boxLabel: 'Summary list of items',
						boxLabelCls : 'radioButtonLabel',
						name : 'summaryType',
						checked: true,
						inputValue: me.SUMMARY_WITHOUT_CHILDREN
					},
					{
						xtype: 'radiofield',
						boxLabel: 'Summary list of items with children',
						boxLabelCls : 'radioButtonLabel',
						name : 'summaryType',
						inputValue: me.SUMMARY_WITH_CHILDREN
					}],
					listeners : {
						scope : me
					}
				}]
			},
			{
				xtype: 'container',
				width: 500,
				margin: '0 20 20 20',
				layout : {
					type : 'hbox',
					align: 'middle',
					pack : 'center'
				},
				listeners : {
					scope : me
				},
				items:[{
					xtype: 'button',
					text: action.title.charAt(0) + action.title.slice(1).toLowerCase(),
					scope : me,
					handler: function() {
						me.currentSummaryType = Ext.ComponentQuery.query('#summaryType')[0].getChecked()[0].inputValue;
						me.dialog.close();
						Ext.ComponentQuery.query('#summaryType')[0].destroy();
						action.func.call(me, true);
					}
				},{
					xtype: 'button',
					margin: '0 0 0 10',
					text: 'Cancel',
					handler: function() {
						me.dialog.close();
						Ext.ComponentQuery.query('#summaryType')[0].destroy();
					}
				}]
			}]
		});
		
		me.dialog.show();
		me.dialog.center();
	},
	
	_exportReport : function(isSummaryReport){
		var me = this;
		if(isSummaryReport){
			me._generateSummaryContent();
		}
		var ua = window.navigator.userAgent;
		if (ua.indexOf("MSIE ") > 0 || !!navigator.userAgent.match(/Trident.*rv\:11\./)){					
			var content = me.EXCEL_TEMPLATE + me.excelContent + "</body></html>";
			var blob = new Blob([content]);
			window.navigator.msSaveOrOpenBlob(blob, me.EXCEL_FILE_NAME); 
		}else{
			me.downloadLink = document.createElement('a');
			me.downloadLink.setAttribute('href', me.EXCEL_URI + me._base64(me.EXCEL_TEMPLATE + me.excelContent + "</body></html>"));
			me.downloadLink.setAttribute('download', me.EXCEL_FILE_NAME);
			me.downloadLink.setAttribute('target', '_blank');
			document.body.appendChild(me.downloadLink); 
			me.downloadLink.click();
		}
	},
	
	_printReport : function(isSummaryReport){
		var me = this;
		if(isSummaryReport){
			me._generateSummaryContent();
		}
		var myWindow = me._openWindow(1024, 768);
        myWindow.document.title = 'Timesheet';
        myWindow.document.write('<html><head><style type="text/css">table{border-collapse: collapse;}table,th,td{border:1px solid black;}</style></head><body>');
        myWindow.document.write(me.excelContent);
        myWindow.document.write('</body></html>');
        myWindow.location.reload();
        myWindow.focus();
		myWindow.print();
        myWindow.close();
	},
	
	_generateSummaryContent : function(){
		var me = this;
		me.excelContent = me._getExcelParamterContent();
		me.excelContent += "<table border=1 style='font-size:11pt'>";
		me.excelContent += "<tr><th>ID</th><th>NAME</th><th>PROJECT</th><th>OWNER</th><th>STATE</th><th>US/DE PLAN ESTIMATE</th><th>TASK ESTIMATE</th><th>TASK TO DO</th>" +
				"<th>TIME SPENT</th><th>TIME SPENT TOTAL</th><th>OUTSTANDING&nbsp;(PLAN EST LESS SPENT)</th></tr>";
		
		me.summaryRowMap.each(function(rows){
			if(me.currentSummaryType == me.SUMMARY_WITHOUT_CHILDREN){
				me.excelContent += rows[0];
			}else{
				_.each(rows, function(row){
					me.excelContent += row;
				});
			}
		});
		me.excelContent += "</table>";
	},
	
	_generateSummaryRowMap : function(){
		var me = this;
		me.summaryRowMap = new Ext.util.MixedCollection();
		var userStory,rows;
		if(me.userStoryComboBox.getRecord().get('_ref')){
			userStory = me.userStoryComboBox.getRecord();
			rows = [];
			me._generateArtifactContent(userStory, 0, rows);
			me.summaryRowMap.add(userStory.get("ObjectID"), rows);
		}else{
			
			for(var i=1, len = me.epicUserStoryStore.getRecords().length; i<len; i++){
				rows = [];
				userStory = me.epicUserStoryStore.getRecords()[i];
				me._generateArtifactContent(userStory, 0, rows);
				me.summaryRowMap.add(userStory.get("ObjectID"), rows);
			}
		}
	},
	
	_generateArtifactContent : function(artifact, indent, rows){
		var me = this;
		var timeSpentTotal;
		var objectID = artifact.get('ObjectID');
		var usContent = "<tr>";
		usContent += "<td style='vertical-align:top'>" + me._getSpace(indent) + artifact.get("FormattedID") + "</td>";
		usContent += "<td style='vertical-align:top'>" + artifact.get("Name") + "</td>";
		usContent += "<td style='vertical-align:top;white-space: nowrap'>" + artifact.get("Project").Name + "</td>";
		usContent += "<td style='vertical-align:top'>" + (artifact.get("Owner")?artifact.get("Owner")._refObjectName : "") + "</td>";
		usContent += "<td style='vertical-align:top'>" + artifact.get("ScheduleState") +"</td>";
		usContent += "<td style='vertical-align:top' width=70>" + me._processNumberValue(artifact.get("PlanEstimate"),true) +"</td>";
		usContent += "<td style='vertical-align:top' width=70>" + me._processNumberValue(artifact.get("TaskEstimateTotal"),true) +"</td>";
		usContent += "<td style='vertical-align:top' width=60>" + me._processNumberValue(artifact.get("TaskRemainingTotal"),true) +"</td>";
		usContent += "<td style='vertical-align:top' width=60>" + me._processNumberValue(me.artifactTimeSpentMap.get(objectID),true) + "</td>";
		// time spent total
		if(artifact.get("_type") == "hierarchicalrequirement" && !artifact.get("Parent")){
			timeSpentTotal = me._processNumberValue(me.timeSpentMap.get(objectID),true);
		}else{
			timeSpentTotal = "";
		}
		usContent += "<td style='vertical-align:top' width=60>" + timeSpentTotal +"</td>";
		// outstanding
		if(artifact.get("_type") == "hierarchicalrequirement" && !artifact.get("Parent") && artifact.get("PlanEstimate") && me.timeSpentMap.get(objectID)){
			usContent += "<td style='vertical-align:top' width=100>" + me._roundFloatNumber(me._processNumberValue(artifact.get("PlanEstimate"), false) - me._processNumberValue(me.timeSpentMap.get(objectID), false)) + "</td>";
		}else{
			usContent += "<td style='vertical-align:top' width=100></td>";
		}
		usContent += "</tr>";
		
		rows.push(usContent);
		
		_.each(me.schedulableArtifacts, function(schedulableArtifact){
			if((schedulableArtifact.get("Parent") && schedulableArtifact.get("Parent").ObjectID == objectID) ||
					(schedulableArtifact.get("Requirement") && schedulableArtifact.get("Requirement").ObjectID == objectID)){
				me._generateArtifactContent(schedulableArtifact, indent + me.INDENT, rows);
			}
		});
		
		_.each(me.tasks, function(task){
			if(task.get("WorkProduct").ObjectID == objectID){
				me._getTaskContent(task, indent + me.INDENT, rows);
			}
		});
	},
	
	_getTaskContent : function(task, indent, rows){
		var me = this;
		var objectID = task.get('ObjectID');
		var taskContent = "<tr>";
		taskContent += "<td>" + me._getSpace(indent) + task.get("FormattedID") + "</td>";
		taskContent += "<td>" + task.get("Name") + "</td>";
		taskContent += "<td style='white-space: nowrap'>" + task.get("Project").Name + "</td>";
		taskContent += "<td>" + (task.get("Owner")?task.get("Owner")._refObjectName : "") + "</td>";
		taskContent += "<td>" + task.get("State") +"</td>";
		taskContent += "<td></td>";
		taskContent += "<td>" + me._processNumberValue(task.get("Estimate"),true) +"</td>";
		taskContent += "<td>" + me._processNumberValue(task.get("ToDo"),true) +"</td>";
		taskContent += "<td>" + me._processNumberValue(me.timeSpentMap.get(objectID),true) +"</td>";
		taskContent += "<td></td>";
		taskContent += "<td></td>";
		taskContent += "</tr>";
		rows.push(taskContent);
	},
	
	_getSpace : function(number){
		var spaceStr = "";
		for(var i=0; i< number; i++){
			spaceStr += "&nbsp;";
		}
		return spaceStr;
	},
	
	_generateDetailContent : function(rows){
		var me = this;
		me.excelContent = me._getExcelParamterContent();
		if(rows.length === 0){
			return;
		}
		me.excelContent += "<table border=1 style='border-collapse: collapse;font-size:11pt'>";
		me.excelContent += "<tr>";
		var index = 0;
		var item;
		while(true){
			if(index == rows.length){
				me.excelContent += "</tr>";
				break;
			}
			item = rows[index];
			if(item.cellCls && item.cellCls.indexOf("headerCol") >= 0){
				me.excelContent += "<th>";
				me.excelContent += item.html;
				me.excelContent += "</th>";
			}else if(item.rowspan){
				me.excelContent += "<td style='text-align: center;vertical-align: top;' rowspan=" + item.rowspan +">";
				me.excelContent += item.html;
				me.excelContent += "</td>";
			}else if(item.colspan){
				me.excelContent += "<td style='text-align: center;font-weight: bold;vertical-align: top' bgcolor=lightgrey colspan=" + item.colspan +">";
				me.excelContent += item.html;
				me.excelContent += "</td>";
			}else{
				me.excelContent += "<td style='vertical-align: top;'>";
				me.excelContent += item.html;
				me.excelContent += "</td>";
			}
			if(item.cellCls && item.cellCls.indexOf("lastCol") >= 0){
				me.excelContent += "</tr>";
				if(index!=rows.length-1){
					me.excelContent += "<tr>";
				}
			}
			index++;
		}
		me.excelContent += "</table>";
	},
	
	_getExcelParamterContent : function(){
		var me = this;
		var parameterContent = "";
		// selected proposal
		parameterContent += me.proposalComboBox.getRawValue() + ", ";
		// selected work package
		if(me.workpackageComboBox.getRecord().get('_ref')){
			parameterContent += me.workpackageComboBox.getRawValue() + ", ";	
		}else{
			parameterContent += "All work packages, ";
		}
		// selected user stories
		if(me.userStoryComboBox.getRecord().get('_ref')){
			parameterContent += me.userStoryComboBox.getRawValue();	
		}else{
			parameterContent += "All user stories";
		}
		// start/end date
		parameterContent += "<br>" + Ext.Date.format(me.startDatePicker.getValue(),'d/m/Y') + " - " + Ext.Date.format(me.endDatePicker.getValue(),'d/m/Y') + "<br>";
		return parameterContent;
	},

	_processNumberValue : function(value, forDisplay){
		if(!value){
			if(forDisplay){
				return '';
			}else{
				return 0;
			}
		}else{
			return value;
		}
	},
	
	_roundFloatNumber : function(number){
		return Math.round(number*100)/100;
	},
	
	_toISOString : function(date){
		return Ext.Date.format(date,'Y-m-d') +"T00:00:00.000Z";
	},
	
	_base64 : function(s){
		return window.btoa(unescape(encodeURIComponent(s)));
	},
	
	_openWindow : function(width, height) {
		var left = (screen.width/2)-(width/2);
		var top = (screen.height/2)-(height/2);
		return window.open('about:blank', '', 'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width='+width+', height='+height+', top='+top+', left='+left);
	}, 
	
	// create new filter based on selected work package or proposal only including epic user stories
	_getEpicUserStoryFilter : function(){
		if(this.workpackageComboBox.getRecord().get('_ref')){
			return [
				{
					property : 'WorkPackage',
					operation : '=',
					value : this.workpackageComboBox.getRecord().get('_ref')
				}, {
					property : 'Parent',
					operation : '=',
					value : null
				}
			];
		}else{
			return [
				{
					property : 'WorkPackage.Parent',
					operation : '=',
					value : this.proposalComboBox.getRecord().get('_ref')
				},
				{
					property : 'Parent',
					operation : '=',
					value : null
				}
			];
		}
	},
	
	//create new filter for user story based on given work package including both epic user stories and their children
	_getUserStoryFilter : function(){
		if(this.workpackageComboBox.getRecord().get('_ref')){
			return [
				{
					property : 'WorkPackage',
					operation : '=',
					value : this.workpackageComboBox.getRecord().get('_ref')
				}
			];
		}else{
			return [
				{
					property : 'WorkPackage.Parent',
					operation : '=',
					value : this.proposalComboBox.getRecord().get('_ref')
				}
			];
		}
	},
	
	//create new filter based on selected user story, work package or proposal
	_getTreeUserStoryFilter : function(){
		
		if(this.userStoryComboBox.getValue()){
			return [
					{
						property : 'ObjectID',
						operation : '=',
						value : this.userStoryComboBox.getRecord().get('ObjectID')
					}
				];
		}
		if(this.workpackageComboBox.getRecord().get('_ref')){
			return [
				{
					property : 'WorkPackage',
					operation : '=',
					value : this.workpackageComboBox.getRecord().get('_ref')
				},
				{
					property : 'Parent',
					operation : '=',
					value : null
				}
			];
		}else{
			return [
				{
					property : 'WorkPackage.Parent',
					operation : '=',
					value : this.proposalComboBox.getRecord().get('_ref')
				},
				{
					property : 'Parent',
					operation : '=',
					value : null
				}
			];
		}
	}
	
});