const emojiRegex = require('emoji-regex');
const e_regex = emojiRegex();

const TOKEN_ORDINARY_TEXT    = "ORDINARY_TEXT";
const TOKEN_CODE_BLOCK_START = "CODE_BLOCK_START";
const TOKEN_CODE_BLOCK_TEXT  = "CODE_BLOCK_TEXT";
const TOKEN_CODE_BLOCK_END   = "CODE_BLOCK_END";
const TOKEN_MODIFIER_START   = "MODIFIER_START";
const TOKEN_MODIFIER_TEXT    = "MODIFIER_TEXT";
const TOKEN_MODIFIER_END     = "MODIFIER_END";
const TOKEN_TABLE_START      = "TABLE_START";
const TOKEN_TABLE_TEXT       = "TABLE_TEXT";
const TOKEN_TABLE_END        = "TABLE_END";

const { EventEmitter } = require('stream');
var tc = require('./termcolors');

class Doku {
    constructor(document_str, headerText, isCentered) {
        if (!process.stdin.isTTY) {
            console.log('Error: TTY is not available. (Don\'t start me with nodemon.)');
            return false;
            // process.exit(1);
        }

        this.helpText = `
@{c.bg.yellow, c.fg.black, " Actions ", c.reset}@
@{begin-table}@
| Action | Description |
|----------------------|
|Next Line            | d, Down Arrow, Enter                                    |
|Previous Line        | a, Up Arrow                                             |
|Next Page (20 lines) | Page Down, Right Arrow                                  |
|Previous Page (20 l) | Page Up, Left Arrow                                     |
|Go To Start          | s, Home                                                 |
|Go To End            | e, End                                                  |
|Go To Line Number    | Print any number. Press Enter to go, q or ESC to cancel |
|Cycle Border Colors  | r                                                       |
|Center Content       | c                                                       |
|Frame Position       | l                                                       |
|Toggle Text Slide    | t                                                       |
|Toggle Patterns      | p                                                       |
| Find Next           | n (Go to next occurence of word if exists)              |
| Find Previous       | b (Go to previous occurence of word if exists)          |
|Open Command Line    | :                                                       |
|Show Help Windows    | h                                                       |
|Quit Application     | q or CTRL+C                                             |
|Quit Help            | h                                                       |
@{end-table}@

@{c.bg.green, c.fg.black, " Commands ", c.reset}@
@{begin-table}@
| Commands | Shortcut | Description | Argument Number | Argument Type |
|---------------------------------------------------------------------|
| switch   | sw       | switches state of given command | 1 | Any |
| toggle   | to       | toggles given command | 1 | Any |
| find     | f        | find all occurences of given text | 1 | Any |
| time     | t        | sets time for text slide | 1 | Number |
| quit     | q        | quits application |
@{end-table}@   

@{c.bg.yellow, c.fg.black, c.underscore, c.bright, " Switch Command ", c.reset}@
@{begin-table}@
| Commands     | Abbr. | Description          | # of Arguments |
|--------------------------------------------------------------|
| block        |       | changes border block | 0 |
| border-color | bc    | changes border color | 0 |
@{end-table}@

@{c.bg.yellow, c.fg.black, c.underscore, c.bright, " Toggle Command ", c.reset}@
@{begin-table}@
| Commands     | Abbr. | Description                | # of Arguments |
|--------------------------------------------------------------------|
| same-color   | sc    | set all borders same color | 0 |
@{end-table}@

@{c.bg.yellow, c.fg.black, c.underscore, c.bright, " Time Command ", c.reset}@
This command takes 1 argument. That argument must be positive number. It is in milliseconds.

@{c.bg.yellow, c.fg.black, c.underscore, c.bright, " Quit Command ", c.reset}@
Quits application...`.split('\n');
        
        // https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
        // \x1b escape character
        // also \u001b can be used.
        
        this.startDate = new Date();
        this.eventEmitter = new EventEmitter();
        
        this.action_timer = 0;
        this.action_limitter = 0;
        
        this.index = 0;
        // this.old_document_index = 0;
        this.parsing_index = 0;
        this.colorIndex = 0;
        this.colorArray = [ 
            tc.FgBlue, tc.FgRed, tc.FgGreen, tc.FgYellow,
            tc.FgMagenta, tc.FgCyan, tc.FgWhite, tc.FgBlack
        ];
        
        this.allTerminalCodes = [
            tc.Bright, tc.Dim, tc.Underscore, tc.Blink, tc.Reverse, tc.Hidden,
            tc.FgBlack, tc.FgRed, tc.FgGreen, tc.FgYellow, tc.FgBlue, tc.FgMagenta, tc.FgCyan, tc.FgWhite,
            tc.BgBlack, tc.BgRed, tc.BgGreen, tc.BgYellow, tc.BgBlue, tc.BgMagenta, tc.BgCyan, tc.BgWhite, tc.Reset
        ];
        
        
        
        this.criticalError = '';
        
        this.timer = null;
        this.timerValid = false;
        this.timeInterval = 1000;
        
        this.readCommand = '';
        this.readNumber = '';
        this.isReadingCommand  = false;
        this.isReadingNumber   = false;
        this.isHelpPrinting    = false;
        // this.isAboutPrinting   = false;
        this.isSameColor       = false;
        this.isFrameCentered   = isCentered;
        this.isContentCentered = false;
        this.betterPatterns    = false;
        
        this.blockChar = '█';
        this.blockCharArray = ['░', '▒', '▓', '█'];
        this.blockCharIndex = 3;
        this.topBlockChar = '▀';
        this.bottomBlockChar = '▄';

        this.headerText = headerText.toString();

        this.original_document = document_str.split('\n');
        this.original_header   = headerText.toString();
        this.document = document_str.split('\n');
        this.processedDocument = [...this.document];

        this.columns = process.stdout.columns;
        this.rows = process.stdout.rows;

        this.searchedWord = '';
        this.searchedWordIndex = 0;
        this.searchFoundIndices = [];
        this.searchIgnoreCase = false;

        this.tabCount = 4;
        this.size();

        this.dlf = this.dataListener.bind(this);
        this.sf = this.size.bind(this);

        // this.newScreen();
        process.stdout.on("resize", this.sf);
        process.stdin.setRawMode(true);
        process.stdin.setEncoding('utf8');
        process.stdin.resume();
    
        // https://iqcode.com/code/javascript/node-stdin-read-char-by-char
        process.stdin.on("data", this.dlf);

        this.eventEmitter.emit("doku-start");
    }

    subToEvent(name, cb) {
        this.eventEmitter.on(name, cb);
    }

    unsubToEvent(name, cb) {
        this.eventEmitter.off(name, cb);
    }

    size() {
        this.columns = process.stdout.columns;
        this.rows = process.stdout.rows;
    
        // When resized, lines are changing thus research.
        if (this.searchedWord != null && this.searchedWord != '')
            this.findStringInProcessedDocument(this.searchedWord);

        this.printContents(true);
    }

    checkLineNumber(lineNumber) {
        if (lineNumber < this.processedDocument.length && lineNumber >= 0)
            this.index = lineNumber;
    }

    resetTerminal() {
        // \033c = \u001Bc' = <ESC>c 
        // Reset Device <ESC>c
        // Reset all terminal settings to default.
        process.stdout.write('\u001Bc');
    }

    handleCommand() {
        let command_str = this.readCommand;
        let command_regex = new RegExp("([a-zA-Z]+)(\\s+[a-zA-Z0-9-]+){0,1}(\\s+[a-zA-Z0-9-]+){0,1}", "g");
        let found = command_regex.exec(command_str);

        if (found!= null && found.length > 2) {

            let command = found[1].toLowerCase();
            let arg     = found[2] != null ? found[2].trim() : found[2];
            let arg2    = found[3] != null ? found[3].trim() : found[3];

            // TODO BETTER SEARCH ALGORITHM.
            if (command == "find" || command == "f") {
                if (arg == undefined || arg == null || arg == '') { 
                    this.searchedWord = '';
                    this.searchedWordIndex = 0;
                    this.searchFoundIndices = [];
                    return "Search is reset.";
                }

                else {
                    if ( this.findStringInProcessedDocument(arg.trim()) )
                        this.index = this.searchFoundIndices[this.searchedWordIndex][0];
                    else
                        return "Word not found";
                }
                
            }

            else if (command == "switch" || command == "sw") {
                switch (arg) {
                    case "block":
                        this.blockCharIndex = (this.blockCharIndex + 1) % this.blockCharArray.length;
                        this.blockChar = this.blockCharArray[this.blockCharIndex];
                        break;
                    
                    case "bc":
                    case "border-color":
                        this.colorIndex = (this.colorIndex + 1) % this.colorArray.length;
                        this.printContents(false);
                        break;
                    default:
                        return "No switch found";
                }
            }

            else if (command == "toggle" || command == "to") {
                switch (arg) {
                    case "sc":
                    case "same-color":
                        this.isSameColor = !this.isSameColor;
                        break;
                    case "ci":
                    case "case-ignore":
                        this.searchIgnoreCase = !this.searchIgnoreCase;
                        return `case ignore: ${this.searchIgnoreCase}`;
                        break;
                    default:
                        return "No toggle found";
                }
            }

            else if (command == "set" || command == "s") {
                switch (arg) {
                    case "rt":
                    case "refresh-time":
                        let parsedArg = parseInt(arg2, 10);
                        if (!isNaN(parsedArg)) {
                            this.action_limitter = parsedArg;
                            return "";
                        } else {
                            return `Given number ${arg2} is not correct.`;
                        }
                        break;
                    default:
                        return "No setable found";
                }
            }

            else if (command == "time" || command == "t") {
                let parsedArg = parseInt(arg, 10);

                if (!isNaN(parsedArg)) {
                    this.timeInterval = parsedArg;
                    return "";
                } else {
                    return `Given number ${arg} is not correct.`;
                }

            } 
           
            else if (command == "quit" || command == "q") {
                this.dataListener("q");
            }

            else if (command == "help") {
                this.dataListener("h");
            }
            
            // Command not found case.
            else {
                return `Command ${command} is not found.`;
            }
        } else {
            return `Bad Command:${command_str}`
        }
    }

    // Escape character ignoring string finder...
    findStringInProcessedDocument(word) {
        let escape_started = false;
        let sfi = [];
        let _word_ = (this.searchIgnoreCase ? word.toLowerCase() : word);
        this.processedDocument.forEach( (el,ndx) => {
            for (let i = 0; i < el.length; i++) {
                if (el[i] == '\x1b') {
                    escape_started = true;
                }

                if (escape_started) {
                    if(el[i] == 'm') {
                        escape_started = false;
                    }
                } else {
                    const pot_word = (this.searchIgnoreCase ? el.slice(i, i + word.length).toLowerCase() : el.slice(i, i + word.length));
                    if (pot_word == _word_) {
                        sfi.push([ndx, i]);
                    }
                }
            } 
        });

        this.searchedWord = word;
        this.searchFoundIndices = sfi;
        this.searchedWordIndex = 0;

        if (this.searchFoundIndices.length == 0)
            return false;
        return true;
    }

    noEscapeCharTextSize(str) {
        let current_str = str;
        let term_re = new RegExp('\\x1b\[[0-9]*m', 'g');

        current_str = current_str.replace(term_re, '')


        return current_str.length;
    }

    terminalColorCharsContains(str) {
        let addedLength = str.length - this.noEscapeCharTextSize(str);
        return addedLength;
    }

    // Reset needs to be the last one in order to reset array.
    terminalColorNextLine(str) {
        let arr = [];
        let escapeCharRegex = new RegExp('\x1b\[[0-9]+m', 'g');
        let all_found = str.match(escapeCharRegex);

        if (all_found == null)
            return arr;

        for (let index = 0; index < all_found.length; index++) {
            const element = all_found[index];
            if (element.startsWith(tc.Reset))
                arr = [];
            else
                arr.push(element);
        }

        return arr;
    }
    
    

    // Takes string `str` and divides it into two by `size` without counting escape chars.
    escapeCharIgnoringSubstringIndex(str, size) {
        let unicodedSize = 0;
        let counter = 0;
        let index = 0;
        let readingEscapeChar = false;
        let substringed = '';

        // don't do anything if sizes are non-positive.
        if (size <= 0 || str.length == 0) {
            return index;
        }

        while(counter != size) {
            
            if (readingEscapeChar) {
                if(str[index] == "m") {
                    readingEscapeChar = false;
                }
                // index++;

            } else {
                // If reading escape character.
                if(str[index] == '\x1b') {
                    readingEscapeChar = true;
                    // index++;
                } 

                // not an escape character.
                else {
                    // index++;
                    counter++;
                }

            } // reading any character

            index++;

            // index reached at the end of string so now return that shit immediately.
            if (index >= str.length) {
                break;
            }

        } // while

        return index;
    }

    escapeCharIgnoringReplace(source_str, replacee) {
        let counter = 0;
        let index = 0;
        let readingEscapeChar = false;
        let new_str = '';
        let size = source_str.length;

        // don't do anything if sizes are non-positive.
        if (size <= 0 || source_str.length == 0) {
            return index;
        }

        while(counter != size) {
            
            if (readingEscapeChar) {
                if(source_str[index] == "m") {
                    readingEscapeChar = false;
                }
                new_str += source_str[index];
                // index++;

            } else {
                // If reading escape character.
                if(source_str[index] == '\x1b') {
                    readingEscapeChar = true;
                    new_str += source_str[index];
                    // index++;
                } 

                // not an escape character.
                else {
                    // index++;
                    new_str += replacee;
                    counter++;
                }

            } // reading any character

            index++;

            // index reached at the end of string so now return that shit immediately.
            if (index >= source_str.length) {
                break;
            }

        } // while

        return new_str;
    }

    // Returns how much space needs to be added to fix length of currently printing line.
    totalEmojiLengths(str) {
        // let tl = 0;
        // let sel = 0;
        // let _el = 0;

        let emojiLacks = 0;
        for (const match of str.matchAll(e_regex)) {
            const emoji = match[0];
            // tl++;
            // sel += [...emoji].length;
            // _el += emoji.length;
            // console.log(`Matched sequence ${ emoji } — code points: ${ [...emoji].length }`);

            let curr = [...emoji].length;
            emojiLacks += curr - Math.ceil(curr/2);
        }
        
        // let x = [...str].length;
        // let y = str.length;

        // for (let xxx = 0; xxx < str.length; xxx++) {
        //     const c0 = str[xxx];
        //     const c1 = str[xxx].charCodeAt(0);
        //     const c2 = str[xxx].charCodeAt(0).toString(16);
        //     const c3 = str[xxx].charCodeAt(0).toString(2);
        //     console.log(c0, '\t', c1, '\t', c2, '\t', c3);
        // }

        // return [tl, sel, _el];
        return emojiLacks;
    }

    // Unused, but works!
    splitLineByMaxWidth(line, max_width) {
        let char_limit_regex = new RegExp(`.{1,${max_width}}`, 'g');
        let rows = line.match(char_limit_regex); 
        if (rows == null) 
            rows = [line];

        return rows;
    }

    printableArrayCodeBlock(arr, max_width) {
        let current_max_width = 0;

        let printable_array = [];
        arr.forEach( (element, ndx) => {
            if (element.length > current_max_width)
                current_max_width = element.length;
        });

        if (current_max_width > max_width - 4)
            current_max_width = max_width - 4;

        arr.forEach((element, ndx) => {
            let splitting_regex = new RegExp(`.{1,${current_max_width}}`, 'g');
            let splitter_row = element.match(splitting_regex); 
            if (splitter_row == null) 
                splitter_row = [''];

            // columns.push(splitter_row);

            splitter_row.forEach(sr => {
                let cel = `${tc.BgBlack}${tc.FgRed}${sr.padEnd(current_max_width, ' ')}${tc.Reset}`;
                printable_array.push(cel);
            });

           
        });

        return printable_array;
    }

    printableTableBlock(table_data, max_width) {
        let table_ok = false;
        let pushable_table_data = [];
        let line_size = max_width - 4;
        let number_of_cols = (table_data[0] != null && table_data[0] != undefined ? table_data[0].length : 0);
        let one_col_size = Math.floor(line_size/number_of_cols);

        let firstLine = `${tc.FgGreen}╔`+ `${'╦'.padStart(one_col_size-1, '═')}`.repeat(number_of_cols).slice(0, -1) +`╗${tc.Reset}`;
        let lastLine  = '╚'+ `${'╩'.padStart(one_col_size-1, '═')}`.repeat(number_of_cols).slice(0, -1) +'╝';
        
        // console.log(firstLine);
        pushable_table_data.push(firstLine);

        for (let index = 0; index < table_data.length; index++) {
            // one row is array of splitted lines.
            const one_row = table_data[index];

            // table header line
            // only available as the second line in the table.
            if (index == 1) {
                let line_ok = true;
                one_row.forEach(col => {
                    let reg_test = /^(-)+$/.test(col)
                    line_ok = line_ok && reg_test;
                });

                if (!line_ok) {
                    table_ok = false;
                    break;
                } else {
                    table_ok = true;
                    let middleLine = `${tc.FgGreen}╠`+ `${'╬'.padStart(one_col_size-1, '═')}`.repeat(number_of_cols).slice(0, -1) +`╣${tc.Reset}`;
                    pushable_table_data.push(middleLine);
                }

            } else {

                // Regular, table data line.
                let columns = [];
                let max_depth = 0;      // how many lines a column needs to be splitted into.

                // For each column in the row, make max width splitting.
                for (let ndx = 0; ndx < number_of_cols; ndx++) {
                    const one_col = one_row[ndx] || "";
                    
                    let splitting_regex = new RegExp(`.{1,${one_col_size-4}}`, 'g');
                    let splitter_row = one_col.match(splitting_regex); 

                    if (splitter_row == null) 
                        splitter_row = '';

                    columns.push(splitter_row);
                    if (splitter_row.length > max_depth)
                        max_depth = splitter_row.length;
                }

                // If not all columns are available than fill rest of the columns.
                while (columns.length != number_of_cols) {
                    columns.push("");
                }

                // Create table visulization.
                for (let i = 0; i < max_depth; i++) {
                    let headerColor = (index == 0 ? `${tc.FgGreen}${tc.Bright}` : '');
                    
                    let line = headerColor + "║";

                    for (let j = 0; j < columns.length; j++) {
                        let current_col = columns[j][i] != undefined ? columns[j][i] : '';
                        line += ` ${current_col} `.padEnd(one_col_size-2, ' ') + `║`;
                    }
                        
                    pushable_table_data.push(line+tc.Reset);
                }

                // Line between table rows. a.k.a splitter.
                if (index != 0 && index != table_data.length - 1) {
                    let splitter = '╟'+ `${'╫'.padStart(one_col_size-1, '─')}`.repeat(number_of_cols).slice(0, -1) +'╢';
                    // console.log(splitter);
                    pushable_table_data.push(splitter);
                }
            }
        }
        // console.log(lastLine);
        pushable_table_data.push(lastLine);
        return pushable_table_data;
    }

    preprocessLine(line){
        return line.replace(/\t/g, " ".repeat(this.tabCount));
    }
    
    // The state before actually printing any.
    normalizeLine(current_line, max_width) {
        let number1 = 0, number2 = 0;
        let normalized_lines = [];

        do {
            let beautified = false;         // For lines made out of complete dashes or such.
            number1 = this.escapeCharIgnoringSubstringIndex(current_line, max_width - 4);
            number2 = current_line.length;
            let curr_str = current_line.substring(0, number1);

            if (this.betterPatterns) {
                if (/^(-){10,}$/.test(curr_str)) {
                    curr_str = this.escapeCharIgnoringReplace(curr_str, '▔');
                    // curr_str = 
                    beautified = true;
                } else if (/^(_){10,}$/.test(curr_str)) {
                    curr_str = this.escapeCharIgnoringReplace(curr_str, '▁');
                    beautified = true;
                } else if (/^(=){10,}$/.test(curr_str)) {
                    curr_str = this.escapeCharIgnoringReplace(curr_str, '═');
                    beautified = true;
                }

                curr_str = curr_str.replace(/==>/g, '⇒');
                curr_str = curr_str.replace(/<==/g, '⇐');

                curr_str = curr_str.replace(/-->/g, '⟶');
                curr_str = curr_str.replace(/<--/g, '⟵');

                // —
                // –
                ////// REPLACE -
                let reg_dash = new RegExp('(-){8,}', 'g');
                let dash_matches;

                while ( (dash_matches = reg_dash.exec(curr_str)) != null) {
                    let length = reg_dash.lastIndex - dash_matches.index;
                    curr_str = curr_str.slice(0, dash_matches.index) + "―".repeat(length) + curr_str.slice(reg_dash.lastIndex);
                }

                ////// REPLACE _
                reg_dash = new RegExp('(_){8,}', 'g');
                dash_matches = null;

                while ( (dash_matches = reg_dash.exec(curr_str)) != null) {
                    let length = reg_dash.lastIndex - dash_matches.index;
                    curr_str = curr_str.slice(0, dash_matches.index) + "▁".repeat(length) + curr_str.slice(reg_dash.lastIndex);
                }

                ////// REPLACE :=
                reg_dash = new RegExp('(:=)', 'g');
                dash_matches = null;

                while ( (dash_matches = reg_dash.exec(curr_str)) != null) {
                    let length = reg_dash.lastIndex - dash_matches.index;
                    curr_str = curr_str.slice(0, dash_matches.index) + "≔" + curr_str.slice(reg_dash.lastIndex);
                }

                ////// REPLACE =:
                reg_dash = new RegExp('(=:)', 'g');
                dash_matches = null;

                while ( (dash_matches = reg_dash.exec(curr_str)) != null) {
                    let length = reg_dash.lastIndex - dash_matches.index;
                    curr_str = curr_str.slice(0, dash_matches.index) + "≕" + curr_str.slice(reg_dash.lastIndex);
                }

                ////// REPLACE ~=
                reg_dash = new RegExp('(~=)', 'g');
                dash_matches = null;

                while ( (dash_matches = reg_dash.exec(curr_str)) != null) {
                    let length = reg_dash.lastIndex - dash_matches.index;
                    curr_str = curr_str.slice(0, dash_matches.index) + "≈" + curr_str.slice(reg_dash.lastIndex);
                }

                ////// REPLACE ~=
                reg_dash = new RegExp('(!=)', 'g');
                dash_matches = null;

                while ( (dash_matches = reg_dash.exec(curr_str)) != null) {
                    let length = reg_dash.lastIndex - dash_matches.index;
                    curr_str = curr_str.slice(0, dash_matches.index) + "≠" + curr_str.slice(reg_dash.lastIndex);
                }
               
            }
            
            // let nls = this.splitLineByMaxWidth(curr_str, max_width - 4);

            normalized_lines.push(curr_str);
            if (beautified)
                break;
        } while ((current_line = current_line.substring(number1, number2 )) != "")

        return normalized_lines;
    }

    /// get tokens and lexemes
    tokenize(current_line, last_state) {
        let Reading_Ordinary   = Symbol("RO");
        let Reading_Modifier   = Symbol("RM");
        let Reading_Code_Block = Symbol("RCB");
        let Reading_Table      = Symbol("RT");

        let tokens  = [];
        let lexemes = [];
        
        let current_lexeme = '';
        let token_type = Reading_Ordinary;

        switch (last_state) {
            case TOKEN_ORDINARY_TEXT:
                token_type = Reading_Ordinary;
                break;

            case TOKEN_MODIFIER_END:
            case TOKEN_CODE_BLOCK_END:
            case TOKEN_TABLE_END:
                token_type = Reading_Ordinary;
                break;

            case TOKEN_CODE_BLOCK_START:
            case TOKEN_CODE_BLOCK_TEXT:
                token_type = Reading_Code_Block;
                break;

            case TOKEN_MODIFIER_START:
            case TOKEN_MODIFIER_TEXT:
                token_type = Reading_Modifier;
                break;

            case TOKEN_TABLE_START:
            case TOKEN_TABLE_TEXT:
                token_type = Reading_Table;
                break;
        
        }

        if (current_line == '') {
            return {
                tokens: [last_state],
                lexemes: [''],
                nested_stack: []
            }  
        }

        let nested_stack = [];
        // Line contains ```, possible code block
        for (let index = 0; index < current_line.length; index++) {
            const char1 = current_line[index];
            const char2 = current_line[index + 1] || null;
            const char3 = current_line[index + 2] || null;

            if (token_type == Reading_Ordinary) {

                // Still = Reading Ordinary
                // Start Modifier
                if (char1 == '@' && char2 == '{') {
                    token_type = Reading_Modifier;
                
                    // Line doesn't start with @{
                    // Something is there.
                    if (current_lexeme != '') {
                        tokens.push(TOKEN_ORDINARY_TEXT);
                        lexemes.push(current_lexeme);
                    }

                    tokens.push(TOKEN_MODIFIER_START);
                    lexemes.push("@{");

                    current_lexeme = '';
                    index += 1;    // two chars.

                    nested_stack.push(TOKEN_MODIFIER_START);
                }

                // Still = Reading Ordinary
                // Code Block Indicator
                else if (char1 == '`' && char2 == '`' && char3 == '`') {

                    token_type = Reading_Code_Block;

                    if (current_lexeme != null && current_lexeme != '') {
                        tokens.push(TOKEN_ORDINARY_TEXT);
                        lexemes.push(current_lexeme);
                    }

                       
                    tokens.push(TOKEN_CODE_BLOCK_START);
                    lexemes.push("```");

                    current_lexeme = '';
                    index += 2; // three chars
                    
                }

                // Ordinary Character.
                else {
                    current_lexeme += char1;
                }
            }

            else if (token_type == Reading_Modifier) {

                // Still = Modifier
                // Nested special modifier.
                if (char1 == '@' && char2 == '{') {

                    current_lexeme += '@{';
                    index += 1;    // two chars.

                    nested_stack.push(TOKEN_MODIFIER_START);
                    
                }

                // Still = Modifier
                // Close special modifier
                else if (char1 == '}' && char2 == '@') {

                    // Last closing modifier.
                    if (nested_stack.pop() == TOKEN_MODIFIER_START
                                            && nested_stack.length == 0) {

                        token_type = Reading_Ordinary;

                        tokens.push(TOKEN_MODIFIER_TEXT);
                        lexemes.push(current_lexeme);

                        tokens.push(TOKEN_MODIFIER_END);
                        lexemes.push("}@");

                        current_lexeme = '';
                        index += 1; // three chars

                    } else {
                        current_lexeme += "}@";
                        index += 1;
                    }

                } 

                else {
                    current_lexeme += char1;
                }
                
            } // Special Modifier


            else if (token_type == Reading_Code_Block) {
                // Still = Code Block
                // Close reading code block
                if (char1 == '`' && char2 == '`' && char3 == '`') {

                    token_type = Reading_Ordinary;

                    tokens.push(TOKEN_CODE_BLOCK_TEXT);
                    lexemes.push(current_lexeme);

                    tokens.push(TOKEN_CODE_BLOCK_END);
                    lexemes.push("```");

                    current_lexeme = '';
                    index += 2; // three chars

                } 

                else {
                    current_lexeme += char1;
                }
            }

            else if (token_type == Reading_Table) {
                // Still = Reading Ordinary
                // Start Modifier
                if (current_line.trim() == "@{end-table}@") {
                    token_type = Reading_Ordinary;
                
                    // Line doesn't start with @{
                    // Something is there.
                    if (current_lexeme != '') {
                        tokens.push(TOKEN_TABLE_TEXT);
                        lexemes.push(current_lexeme);
                    }

                    tokens.push(TOKEN_TABLE_END);
                    lexemes.push("");

                    current_lexeme = '';
                    index += current_line.length;
                }

                // Ordinary Character.
                else {
                    current_lexeme += char1;
                }
                                
            }

        }

        if (current_lexeme != '' && current_lexeme != null) {
            switch (token_type) {
                case Reading_Ordinary:
                    tokens.push(TOKEN_ORDINARY_TEXT);
                    break;
                
                case Reading_Modifier:
                    tokens.push(TOKEN_MODIFIER_TEXT);
                    break;
                
                case Reading_Code_Block:
                    tokens.push(TOKEN_CODE_BLOCK_TEXT);
                    break;

                case Reading_Table:
                    tokens.push(TOKEN_TABLE_TEXT);
                    break;
            }
            lexemes.push(current_lexeme);
        }

        return {
            tokens: tokens,
            lexemes: lexemes,
            nested_stack: nested_stack
        }       
    }

    processModifiers(tokens, lexemes) {
        let inside_string = false;
        let inside_ignore = false;
        let potential_modifiers = [];
        let current_modifier = '';

        let actual_modifiers = [];
        let actual_tokens = [];
        
        for (let i = 0; i < tokens.length; i++) {
            const c_token  = tokens[i];
            const c_lexeme = lexemes[i];

            // @{ or }@
            if (c_token == TOKEN_MODIFIER_START || c_token == TOKEN_MODIFIER_END)  {
                tokens.splice(i, 1);
                lexemes.splice(i, 1);
                i--;
            } else if ( c_token == TOKEN_MODIFIER_TEXT ) {
                //////////////////////////////////////////////////////////////////////////////////////

                for (let index = 0; index < c_lexeme.length; index++) {
                    const ch  = c_lexeme[index];
                    const ch2 = c_lexeme[index+1];
                    if (ch == '_' && ch2 == '_') {
                        inside_ignore = !inside_ignore;
                    }
                    else if (ch == '"') {
                        inside_string = !inside_string;
                    }
        
                    if (ch == ',' && !inside_string && !inside_ignore) {
                        potential_modifiers.push(current_modifier);
                        current_modifier = '';
                    } else {
                        current_modifier += ch;
                    }
                }
        
                if (current_modifier != '') {
                    potential_modifiers.push(current_modifier);
                    current_modifier = '';
                }
        
                potential_modifiers.forEach( (keyword, ndx) => {
                    keyword = keyword.trim();
        
                    if (/__(.*)__/.test(keyword)) {
                        let match = /__(.*)__/.exec(keyword);
                        actual_modifiers.push(match[1]);
                        actual_tokens.push(TOKEN_ORDINARY_TEXT);
                        return;
                    } 
                    
                    else if(/^".*"$/.test(keyword)) {
                        actual_modifiers.push(keyword.slice(1,-1));
                        actual_tokens.push(TOKEN_ORDINARY_TEXT);
                        return;
                    }
        
                    switch (keyword.toLowerCase()) {
                        case 'begin-table':
                            actual_modifiers.push('');
                            actual_tokens.push(TOKEN_TABLE_START);
                            break;
        
                        case 'end-table':
                            actual_modifiers.push('');
                            actual_tokens.push(TOKEN_TABLE_END);
                            break;
                            
                        case 'c.reset':
                            actual_modifiers.push(tc.Reset);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bright':
                            actual_modifiers.push(tc.Bright);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.dim':
                            actual_modifiers.push(tc.Dim);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.underscore':
                            actual_modifiers.push(tc.Underscore);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.blink':
                            actual_modifiers.push(tc.Blink);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.reverse':
                            actual_modifiers.push(tc.Reverse);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.hidden':
                            actual_modifiers.push(tc.Hidden);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.fg.black':
                            actual_modifiers.push(tc.FgBlack);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
                            
                        case 'c.fg.red':
                            actual_modifiers.push(tc.FgRed);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.fg.green':
                            actual_modifiers.push(tc.FgGreen);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.fg.yellow':
                            actual_modifiers.push(tc.FgYellow);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.fg.blue':
                            actual_modifiers.push(tc.FgBlue);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.fg.magenta':
                            actual_modifiers.push(tc.FgMagenta);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.fg.cyan':
                            actual_modifiers.push(tc.FgCyan);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.fg.white':
                            actual_modifiers.push(tc.FgWhite);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bg.black':
                            actual_modifiers.push(tc.BgBlack);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bg.red':
                            actual_modifiers.push(tc.BgRed);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bg.green':
                            actual_modifiers.push(tc.BgGreen);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bg.yellow':
                            actual_modifiers.push(tc.BgYellow);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bg.blue':
                            actual_modifiers.push(tc.BgBlue);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bg.magenta':
                            actual_modifiers.push(tc.BgMagenta);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bg.cyan':
                            actual_modifiers.push(tc.BgCyan);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'c.bg.white':
                            actual_modifiers.push(tc.BgWhite);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
                        
                        case 'c.header':
                            actual_modifiers.push(`${tc.BgBlue}${tc.FgBlack}`);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;

                        case 'c.warning':
                            actual_modifiers.push(`${tc.BgBlack}${tc.FgYellow}`);
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        case 'shrug':
                            actual_modifiers.push('¯\\_(ツ\u2063)_/¯');
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
                        
                        case 'startdate':
                            actual_modifiers.push(this.startDate.toISOString())
                            actual_tokens.push(TOKEN_ORDINARY_TEXT);
                            break;
        
                        default:
                            // replacedKeywords.push(' ');
                            break;
                    }
                });

                //////////////////////////////////////////////////////////////////////////////////////

                tokens.splice(i, 1, ...actual_tokens);
                lexemes.splice(i, 1, ...actual_modifiers);
                i = i + actual_tokens.length - 1;
            }
        }
        
        let is_it_table = false;
        for (let j = 0; j < tokens.length; j++) {
            const c_token = tokens[j];
            const c_lexeme = lexemes[j];

            if (c_token == TOKEN_TABLE_START) {
                is_it_table = true;
                continue;
            }

            else if (c_token == TOKEN_TABLE_END) {
                is_it_table = false;
            }

            if (is_it_table) {
                tokens[j] = TOKEN_TABLE_TEXT;
            }
        }
    }

    createLineWithTokens(tokens, lexemes, queues, max_width) {
        let serialized = '';
        let next_block_token = null;
        let block_starter = false;

        for (let index = 0; index < tokens.length; index++) {
            let c_token  = tokens[index];
            let c_lexeme = lexemes[index];
            
            switch (c_token) {
                case TOKEN_CODE_BLOCK_START:
                case TOKEN_MODIFIER_START:
                case TOKEN_MODIFIER_END:
                    break;
                
                // CODE BLOCK
                case TOKEN_CODE_BLOCK_TEXT:
                    if (tokens[index + 1] == TOKEN_CODE_BLOCK_END) {
                        serialized += `${tc.BgBlack}${tc.FgRed}${c_lexeme}${tc.Reset}`
                    }
                    else 
                        queues.current_block.push(c_lexeme);
                    break;

                case TOKEN_CODE_BLOCK_END:
                    if (tokens[index - 2] != TOKEN_CODE_BLOCK_START) {
                        queues.printing_queue.push(...this.printableArrayCodeBlock(queues.current_block, max_width));
                        queues.current_block.splice(0,queues.current_block.length); // clear array
                    }
                    break;

                // // MODIFIER
                // case TOKEN_MODIFIER_TEXT:
                //     let [modifiers, _next_state ] = this.processSpecialModifiers(c_lexeme);
                //     next_block_token = _next_state;
                //     serialized += modifiers;
                //     break;
                
                case TOKEN_ORDINARY_TEXT:
                    serialized += c_lexeme;
                    // tl.printing_queue.push(serialized);
                    break;

                case TOKEN_TABLE_TEXT:
                    queues.current_block.push(c_lexeme);
                    break;

                case TOKEN_TABLE_START:
                    break;

                case TOKEN_TABLE_END:
                    let pretty_table = [];
                    queues.current_block.forEach(row => {
                        let pushee = row.split('|').slice(1, -1).map(el => el.trim());
                        if (pushee != '')
                            pretty_table.push(pushee);
                    })

                    if (pretty_table.length != 0)
                        pretty_table = this.printableTableBlock(pretty_table, max_width);

                    queues.printing_queue.push(...pretty_table);
                    queues.current_block.splice(0,queues.current_block.length);

                    next_block_token = TOKEN_ORDINARY_TEXT;

                default:
                    break;
            }
        }

        let normalized = this.normalizeLine(serialized, max_width);

        // Actual empty line and nothing to print
        if (queues.current_block.length == 0 && serialized.length == 0) {
            queues.printing_queue.push(...normalized);
        }

        else if (queues.current_block.length > 0 && serialized.length == 0) {
            // filling code block or array, do not print anything
        }

        else if (queues.current_block.length == 0 && serialized.length > 0) {
            queues.printing_queue.push(...normalized);
        }

        else if (queues.current_block.length > 0 && serialized.length > 0) {
            queues.printing_queue.push(...normalized);
        }
        return next_block_token;
    }

    parse(max_width) {
        // Displaying HELP text...
        if (this.isHelpPrinting) {
            this.document = this.helpText;
            this.headerText = " H E L P ";
        } else {
            this.document = this.original_document;
            this.headerText = this.original_header;
            if (this.headerText.length > max_width - 6) {
                let div = (max_width - 8)/2;
                this.headerText = this.headerText.substring(0, div) + "..." + this.headerText.substring(this.headerText.length-div);
            }
        }
        
        let length_of_previous_doc = this.processedDocument.length;
        let copy_of_document = [...this.document];
        let printing_queue = [];
        let current_block = [];
        let last_state = TOKEN_ORDINARY_TEXT;
        this.parsing_index = 0;

        for (let ndx = 0; ndx < copy_of_document.length; ndx++) {
            let line = copy_of_document[ndx];
            this.parsing_index++;
            let current_line = this.preprocessLine(line);

            // Process data but set state at the end of loop
            let { tokens, lexemes, nested_stack } = this.tokenize(current_line, last_state);

            // Error case, set whole document to error.
            if (nested_stack[0] == TOKEN_MODIFIER_START) {
                let error_message = `>> PARSING ERROR AT LINE ${this.parsing_index}: Unclosed Modifier, expecting @} <<`;
                let error_print_text = `${' '.padStart((max_width-error_message.length)/2, ' ')}${tc.BgRed}${tc.FgBlack}${tc.Blink}${error_message}${tc.Reset}`;
                this.criticalError = error_message;
                this.processedDocument = this.normalizeLine(error_print_text, max_width);
                return;
            }

            this.processModifiers(tokens, lexemes);
            let queues = {
                current_block,
                printing_queue
            };

            let possible_next_state = this.createLineWithTokens(tokens, lexemes, queues, max_width);
            last_state = possible_next_state || tokens[tokens.length-1] || TOKEN_ORDINARY_TEXT;
        };
        
        this.parsing_index = 0;
        this.processedDocument = printing_queue;
        this.index = (parseInt((this.index * this.processedDocument.length) / length_of_previous_doc)) % this.processedDocument.length;
    }

    // Print Contents of File
    printContents(sizeChanged, errorMessage) {
        if (Date.now() - this.action_timer >= this.action_limitter) {
            this.action_timer = Date.now();
        } else {
            return;
        }

        let max_width = Math.min(this.columns, 124);
        let isScreenBigger = (max_width < this.columns);

        // reparse file.
        if (sizeChanged) {
            this.parse(max_width);
        }

        let errorMessageExists = (errorMessage !== undefined && errorMessage !== null && errorMessage !== "") || (this.criticalError != '');
        let currentErrorMessage = this.criticalError || errorMessage;

        if (this.index > this.processedDocument.length - this.rows + 4) {
            this.index = this.processedDocument.length - this.rows + 4;
        }

        if (this.index < 0) {
            this.index = 0;
        }

        let selectedLines = this.processedDocument.slice(this.index, this.index + this.rows - 4);
        let newlines;

        let percent = Math.floor((((this.index) / (this.processedDocument.length - (selectedLines.length))) * 100).toFixed(2));
        if (isNaN(percent))
            percent = 100;

        let count = this.rows - selectedLines.length - 3;
        newlines = "".padEnd(count, "\n");

        // TODO change between toggle and cycle
        // this.colorIndex = this.isRGB ? (this.colorIndex + 1) % this.colorArray.length : this.colorIndex;
        let currColor = this.colorArray[this.colorIndex];

        let header = this.blockChar + this.headerText.padStart(this.headerText.length + Math.floor((max_width - this.headerText.length - 2) / 2), this.topBlockChar).padEnd(max_width - 2, this.topBlockChar) + this.blockChar;
        let tailer = `${this.blockChar.padEnd(max_width - 1, this.bottomBlockChar)}${this.blockChar}`;
        
        ////// Status Line Creation
        let statusLine = '';
        let readNumberStatus = '';
        let locationStatus = `${percent}% ↔ [${this.index}-${this.index + selectedLines.length - 1}]/${this.processedDocument.length - 1}`;

        if (this.isReadingNumber) {
            readNumberStatus = `Waiting line number: ${this.readNumber} (ESC to cancel)`;
        } else if (this.isReadingCommand) {
            readNumberStatus = `:${this.readCommand} (ESC to cancel)`;
        } else if (errorMessageExists) {
            readNumberStatus = `${currentErrorMessage}`
        }

        statusLine = readNumberStatus.padEnd(max_width - locationStatus.length, ' ') + locationStatus;

        //////

        // CENTERING
        if (this.isFrameCentered && isScreenBigger) {
            header = header.padStart(header.length + Math.floor( (this.columns - header.length) / 2 ), ' ').padEnd(this.columns, ' ');
            tailer = tailer.padStart(tailer.length + Math.floor( (this.columns - tailer.length) / 2 ), ' ').padEnd(this.columns, ' ');
            statusLine = statusLine.padStart(statusLine.length + Math.floor( (this.columns - statusLine.length) / 2 ), ' ').padEnd(this.columns, ' ');
        }
        
        let print_buffer = ['\u001Bc']; // this.resetTerminal();
        print_buffer.push(`${(this.isSameColor ? currColor : tc.FgGreen)}${header}${tc.Reset}\n`);
         
        let startBlock = `${currColor}${this.blockChar}${tc.Reset} `;
        let endBlock   = `${tc.Reset} ${currColor}${this.blockChar}${tc.Reset}`;
        let prevLineColor = [];
        
        selectedLines.forEach( (element, ndx) => {
            let prevLined   = `${prevLineColor.join('')}${element}`;    // Used only for getting current line as previous for next iteration of the loop.
            let currElement = `${prevLineColor.join('')}${element}`;
            
            // If this line contains searched element.
            if (this.searchFoundIndices.length > 0 && this.index + ndx == this.searchFoundIndices[this.searchedWordIndex][0]) {
                let strIndex = this.searchFoundIndices[this.searchedWordIndex][1];               
                let colorBefore = this.terminalColorNextLine(currElement.substring(0, strIndex));
                let before = currElement.substring(0, strIndex);
                let middle = `${tc.Underscore}${tc.Blink}${tc.BgYellow}${tc.FgBlack}${currElement.substring(strIndex, strIndex+this.searchedWord.length)}${tc.Reset}`;
                let after  = `${colorBefore.join('')}${currElement.substring(strIndex+this.searchedWord.length)}`;
                currElement = before + middle + after;
            }

            let escapeCharsAdd = this.terminalColorCharsContains(currElement); //+ this.totalEmojiLength(currElement);
            let emojiLacks     = this.totalEmojiLengths(currElement);

            let justBlockSizes   = 4;
            let centeringPadding = 0;       // Reset added after line endes in centered version.

            let padEndLenght      = max_width + escapeCharsAdd + emojiLacks - justBlockSizes;
            let padEndCurrElement = `${currElement.normalize().padEnd(padEndLenght, ' ')}`;

            // let the_line_of_spaces = " ".repeat(padEndLenght);
            // padEndCurrElement = the_line_of_spaces.padStart(currElement.length, currElement);
            
            // c is pressed.
            if (this.isContentCentered) {
                let centerContentPadStart = currElement.length + Math.floor((max_width + escapeCharsAdd + emojiLacks - currElement.length) / 2) -2;
                let centerContentPadEnd   = max_width + escapeCharsAdd + emojiLacks - justBlockSizes + tc.Reset.length;

                padEndCurrElement = `${currElement.padStart(centerContentPadStart, ' ')}${tc.Reset}`.padEnd(centerContentPadEnd, ' ');
                centeringPadding  = tc.Reset.length;
            }

            let whitetext =  startBlock + padEndCurrElement + endBlock;

            // l is pressed.
            if (this.isFrameCentered && isScreenBigger) {
                // 11 = 9 + (tc.Reset for endblock.)
                let whitetextPadStart = whitetext.length + Math.floor( (this.columns + escapeCharsAdd + emojiLacks + centeringPadding - whitetext.length) / 2 ) + 11;
                whitetext = whitetext.padStart(whitetextPadStart, ' ').padEnd(this.columns , ' ');
            }
            print_buffer.push(`${whitetext}\n`);
            prevLineColor = this.terminalColorNextLine(prevLined);
        });

        print_buffer.push(`${(this.isSameColor ? currColor : tc.FgGreen)}${tailer}\n`);     
        print_buffer.push(`${(errorMessageExists?tc.FgRed:tc.FgGreen)}${statusLine}`);
        print_buffer.push(newlines);
        print_buffer.push(`>> ${tc.FgRed}d/enter:↓ a:↑ h: help q: quit${tc.Reset}`);

        let single_line = print_buffer.join('');
        process.stdout.write(single_line);
    }



    //// Key event listener
    dataListener(key) {
        // Reading Command
        if(this.isReadingCommand) {
            if (key === "\u001B[A" || key === "\u001B[B" || key === "\u001B[C" || key === "\u001B[D" || key === '\u0003')
                return;

            if (key === "\u001B") {             // escape character
                this.isReadingCommand = false;
                this.readCommand = '';
                this.printContents(false);

            } else if (key === "\r") {          // enter
                this.isReadingCommand = false;
                let result = this.handleCommand();
                this.readCommand = '';
                this.printContents(false, result);

            } else if (key === "\u007F") {      // delete key
                this.readCommand = this.readCommand.slice(0, -1);
                this.printContents(false);
            
            } else {
                this.readCommand += key;
                this.printContents(false);
            }
            return;
        }

        // Check if given key is number.
        if (!isNaN(parseInt(key))) {
            // if numeric then set
            this.isReadingNumber = true;
            this.readNumber += key;
            this.printContents(false);
            return;

        } else if (this.isReadingNumber) {
            if (key === "\u007F") { // delete key
                this.readNumber = this.readNumber.slice(0, -1);
                this.printContents(false);
            } else if (key === "\r") {      // enter
                this.isReadingNumber = false;
                this.checkLineNumber(parseInt(this.readNumber));
                this.readNumber = '';
                this.printContents(false);
            } else if (key === "\u001B" || key === "q") {      // escape or q
                this.isReadingNumber = false;
                this.readNumber = '';
                this.printContents(false);
            }
            return;
        }

        // CTRL + C
        if (key === '\u0003') {
            this.resetTerminal();
            clearInterval(this.timer);
            process.exit();
        }

        else if (key === "h" || key === "H") {
            this.isHelpPrinting = !this.isHelpPrinting;
            this.resetTerminal();
            this.index = 0;
            this.printContents(true);
        }

        // Quitting
        else if (key === "q" || key === "Q") {
            process.stdout.write("\nquiting...\n");
            clearInterval(this.timer);
            this.resetTerminal();
           
            // https://iqcode.com/code/javascript/node-stdin-read-char-by-char
            process.stdout.removeListener("resize", this.sf);
            process.stdout.off("resize", this.sf);

            process.stdin.removeListener("data", this.dlf);
            process.stdin.off("data", this.dlf);

            process.stdin.setRawMode(false);
            process.stdin.resume();

            this.eventEmitter.emit('doku-end');
        }

        else if (key === "\u001B[6~" || key === "\u001B[C") {
            this.index = (this.index + 20);
            this.printContents(false);
        }

        else if (key === "\r" || key === "d" || key === "D" || key === "\u001B[B") {
            this.index = (this.index + 1);
            this.printContents(false);
        }

        else if (key === "\u001B[5~" || key === "\u001B[D") {
            this.index = (this.index - 20);
            this.printContents(false);
        }

        else if (key === "a" || key === "A" || key === "\u001B[A") {
            this.index = (this.index - 1);
            this.printContents(false);
        }

        else if (key === "e" || key === "E" || key === "\u001B[F") {
            this.index = (this.processedDocument.length - 1);
            this.printContents(false);
        }

        else if (key === "s" || key === "S" || key === "\u001B[H") {
            this.index = 0;
            this.printContents(false);
        }

        else if (key === "r" || key === "R") {
            this.colorIndex = (this.colorIndex + 1) % this.colorArray.length;
            this.printContents(false);
        }

        else if (key === "c" || key === "C") {
            this.isContentCentered = !this.isContentCentered;
            this.printContents(false);
        }

        else if (key === "l" || key === "L") {
            this.isFrameCentered = !this.isFrameCentered;
            this.printContents(false);
        }

        else if (key === "p" || key === "P") {
            this.betterPatterns = !this.betterPatterns;
            this.printContents(true);
        }

        else if (key === "n" || key === "N") {
            if (this.searchedWord != null && this.searchedWord != '') {
                this.searchedWordIndex = (this.searchedWordIndex + 1)  % this.searchFoundIndices.length;
                this.index = this.searchFoundIndices[this.searchedWordIndex][0];
                this.printContents(false);
            } else {
                this.printContents(false, "No search keyword found.");
            }
        }

        else if (key === "b" || key === "B") {
            if (this.searchedWord != null && this.searchedWord != '') {
                this.searchedWordIndex = (this.searchedWordIndex - 1 + this.searchFoundIndices.length)  % this.searchFoundIndices.length;
                this.index = this.searchFoundIndices[this.searchedWordIndex][0];
                this.printContents(false);
            } else {
                this.printContents(false, "No search keyword found.");
            }
        }

        else if (key === "t" || key === "T") {
            this.timerValid = !this.timerValid;
            if (this.timerValid) {
                this.timer = setInterval(function name() {
                    this.dataListener('d');
                }.bind(this), this.timeInterval);
                
            } else {
                clearInterval(this.timer);
            }
        }

        else if (key === ":") {
            this.isReadingCommand = true;   
            this.isReadingNumber = false;   // do not read line numbers.
            clearInterval(this.timer);      // end scrolling when reading command.
            this.timerValid = false;
            this.printContents(false);      
        }

        else if (key === "\n") { }

        else {
            this.printContents(false, `Not Mapped Key: ${key}`)
        }
    }

}

module.exports = Doku;