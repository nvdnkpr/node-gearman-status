var net          = require ('net');
var eventEmitter = require ('events').EventEmitter;

nodeGearmanStatus = function (port, host, buffer_size, interval_polling) {  
  
  self = this;
   
  this.socket           =net.connect(port, host);  
  this.socket.setEncoding("ascii");
  this.timer            =new eventEmitter();
  
  this.history_workers = {
    circularBuffer : new Array (),  //array contains records with data and date
    write_point:     0
  };
  
  this.buffer_size      = buffer_size;
  this.interval_polling = interval_polling;
  this.full_buffer      = false; 
  this.number_workers   = 0;
  this.count            = 0;
  this.before_running = []; 
  this.before_capable = [];
  this.before_waiting = [];
  this.first          = true;  //to init the array before
  
  //init the circular buffer and wite_point
  for (var i=0; i<this.buffer_size; i++){
    this.history_workers.circularBuffer.push({date: 0, data:0});
  }
  this.history_workers.write_point=0;
  
  this.socket.on ('error', function (e) {
    console.log ("[nodeGearmanStatus]: Error connecting to gearman job server at "+host+":"+port+": "+e);
  });
  
  this.socket.on('connect', function (){
    console.log ("[nodeGearmanStatus]: Connected to gearman job server at "+host+":"+port);
  });
  
  var data_received=''; 
  
  this.socket.on ('data', function (chunk) {
    data_received+=chunk;
    if (data_received.indexOf("\n.\n")>0) {   
      workers = self.parse_data_received (data_received.substring(0, data_received.length-3)); 
      data_received = '';
      self.number_workers = workers.length;
      self.count++; 
      //full buffer -> write_point= 0
      if (self.history_workers.write_point>=self.buffer_size) {
        self.history_workers.write_point=self.history_workers.write_point%self.buffer_size;
        self.full_buffer=true;
      }

      //init the arrays
      if (self.first){ 
         for (var i=0; i<self.number_workers; i++){  
            self.before_running[i]=0;
            self.before_waiting[i]=0;
            self.before_capable[i]=0;
         }
         self.first=false;
      } 
      else{
         if (self.count%60==0){ //polling each second but save the data each minute. Save higher values of each minute
           for (i=0; i<self.number_workers; i++){    
               workers[i].data[0]=self.before_waiting[i];
               workers[i].data[1]=self.before_running[i];
               workers[i].data[2]=self.before_capable[i];          
            }
            self.startTime=new Date();
            self.history_workers.circularBuffer[self.history_workers.write_point]={data: workers, date: self.startTime};
            self.history_workers.write_point++;  
            
            for (var i=0; i<self.number_workers; i++){   //each minute, reset the array
               self.before_running[i]=0;
               self.before_waiting[i]=0;
               self.before_capable[i]=0;
            } 
         }
         else{
            for (var i=0; i<self.number_workers; i++){   //each second, save before arrays the higher values
               if (self.before_waiting[i]<workers[i].data[0] ) {
                  self.before_waiting[i]=workers[i].data[0];
               }              
               if (self.before_running[i]<workers[i].data[1] ) {
                  self.before_running[i]=workers[i].data[1];
               }
              
               if (self.before_capable[i]<workers[i].data[2] ){
                  self.before_capable[i]=workers[i].data[2]; 
               }     
            }
         }
      }
    }
  });
};

nodeGearmanStatus.prototype.parse_data_received = function (data_received) {   
   

   /*
    data_received has this format:  
    
    This sends back a list of all registered functions.  Next to
    each function is the number of jobs in the queue, the number of
    running jobs, and the number of capable workers. The columns are
    tab separated, and the list is terminated with a line containing
    a single '.' (period). The format is:

         FUNCTION\tTOTAL\tRUNNING\tAVAILABLE_WORKERS
    */
  
    var data_parsed= [];
    var aux= new Array() ;
    var data_line= data_received.split("\n");  
    
    for (var i=0; i<data_line.length; i++){ 
      aux2=data_line[i].split("\t");
      aux.push(aux2);
    }

    for (var j=0; j<aux.length; j++){ 
      data_parsed.push({name:aux[j][0], data:[parseInt(aux[j][1]),parseInt(aux[j][2]),parseInt(aux[j][3])] });
    }
    return data_parsed;
};

nodeGearmanStatus.prototype.initHistory = function () {

  var self=this;

  this.timer.on ("elapsed", function () {   //event
    self.socket.write ("status\n");
  });
  
  this.startTime = new Date();              //generate the actual date and time
  this.socket.write ("status\n");               
  
  setInterval (function() { self.timer.emit("elapsed"); }, self.interval_polling);  //interval_polling 
  
  console.log("GearmanStatus: Event init");
}


nodeGearmanStatus.prototype.writeHistory = function (){
   /*
    We must read from write_point is, because the point will advance after write.m 
    We must read from write_point is until the end and, after, the beginning. The exception is the first time
    */

  var self=this;
  var history_array= [];
  var history_array_all= [];

  if (!this.full_buffer) {      //buffer is not full at least one time
    for (i=0; i < this.history_workers.write_point; i++){   
      history_array= [];
      for (j=0; j < this.number_workers; j++) {  
        history_array.push ({name:    this.history_workers.circularBuffer[i].data[j].name, 
                             date:    this.history_workers.circularBuffer[i].date, 
                             workers: this.history_workers.circularBuffer[i].data[j].data}); 
      }
      history_array_all.push (history_array);
    }

    return history_array_all;  
 
  }
  
  else {  
    var history_array_all= [];
    for (i=this.history_workers.write_point; i<this.buffer_size; i++){   //from point to end
      history_array= [];
      for (j=0; j < this.number_workers; j++) {  
        history_array.push ({name:    this.history_workers.circularBuffer[i].data[j].name, 
                             date:    this.history_workers.circularBuffer[i].date, 
                             workers: this.history_workers.circularBuffer[i].data[j].data});                    
      }
      history_array_all.push (history_array);
    } 
    
    for (i=0; i<this.history_workers.write_point-1; i++){   //from beginning yo point-1
      history_array= [];
      for (j=0; j<this.number_workers; j++) {  
        history_array.push({name:    this.history_workers.circularBuffer[i].data[j].name, 
                            date:    this.history_workers.circularBuffer[i].date, 
                            workers: this.history_workers.circularBuffer[i].data[j].data});                    
      }
      history_array_all.push(history_array);
    } 
    return history_array_all;  
  }  

};

/*
 history_array_all returns an array of records where name is the name of each worker, 
 date is the date of each event and workers are the data of the status (waiting, running and capable workers) of each event.
 
 */


module.exports = nodeGearmanStatus;