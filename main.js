var c = document.getElementById("c")
var ctx = c.getContext("2d")
//c.style.webkitFilter = 'blur(8px)'
c.width = window.innerWidth
c.height = window.innerHeight

var values = [3, 30, 0.004, 200, 1, 3, 0.00001, 0.266666, -0.00002]

var pointSize = 3
var smoothingRadius = 30
var targetDensity = 0.004
var pressureMult = 200
var gravity = 1
var viscosityScale = 3
var nearPressureMult = 0.00001
var smoothingFactor = 0.266666
var nearSmoothingDerivativeMult = -0.00002

var mouseInteractionR = 100
var mouseInteractionStr = 0.04



var boxes = document.querySelectorAll("#options input")

for(var i = 0; i < values.length; i++)
	boxes[i].value = values[i]

var cells = []
var cellSize = smoothingRadius*2

var particleCount = 4000

var pause = 0

var width = Math.ceil(c.width/cellSize)
var height = Math.ceil(c.height/cellSize)

var shifts = [-width-1, -width, -width+1, -1, 0, 1, width-1, width, width+1]

var mouse = {
	x: 0,
	y: 0,
	down: false,
	key: 0,
}

var obstacles = []

var obPlaceData = undefined

var options = 0

class Point{
	constructor(x, y, id, cellId=0){
		this.x = x
		this.y = y
		this.screenX = (cellId%width)*width+x
		this.screenY = Math.floor(cellId/width)*width+y
		this.predictedX = this.screenX
		this.predictedY = this.screenY
		this.vx = 0
		this.vy = 0
		this.cellId = cellId
		this.id = id
		this.density = 0
		this.nearDensity = 0
	}
}

function smoothing(r, dst){
	if(dst >= r) return 0
	var v = (Math.PI * r**4) * smoothingFactor
	return (r-dst)**2 / v
}

function viscosity(r, dst){
	if(dst >= r) return 0
	var v = (r*r-dst*dst)/5000
	return v*v*v
}

function smoothingDerivative(r, dst){
	if(dst >= r) return 0
	var scale = 12 / (r**4 * Math.PI)
	return (dst-r) * scale
}

function nearSmoothing(r, dst){
	if(dst > r) return 0
	return (r-dst)**3 * 0.0002
}

function smoothingNearDerivative(r, dst){
	if(dst > r) return 0
	return (r-dst)**2 * nearSmoothingDerivativeMult
}

function densityToPressure(d){
	return (d - targetDensity) * pressureMult
}
function nearDensityToPressure(d){
	return d * nearPressureMult
}
function calculatePressureForce(samplePoint){
	var forceX = 0
	var forceY = 0

	for(var i = 0; i < 9; i++){
		var currentCellId = samplePoint.cellId+shifts[i]
		if(currentCellId < 0 || currentCellId >= cells.length) continue
		var cell = cells[currentCellId]

		cell.forEach(point => {
			var dst = Math.sqrt((samplePoint.predictedX-point.predictedX)**2 + (samplePoint.predictedY-point.predictedY)**2)
			if(dst == 0 || dst > smoothingRadius) return 0
			var slope = smoothingDerivative(smoothingRadius, dst)
			var slope2 = smoothingNearDerivative(smoothingRadius, dst)
			var sharedPressure = (densityToPressure(point.density)+densityToPressure(samplePoint.density))/2
			var sharedNearPressure = (nearDensityToPressure(point.nearDensity)  + nearDensityToPressure(samplePoint.nearDensity)) / 2
			
			forceX += (point.predictedX-samplePoint.predictedX)/dst*slope*sharedPressure/point.density
			forceY += (point.predictedY-samplePoint.predictedY)/dst*slope*sharedPressure/point.density
			
			forceX += (point.predictedX-samplePoint.predictedX)/dst*slope2*sharedNearPressure/point.nearDensity
			forceY += (point.predictedY-samplePoint.predictedY)/dst*slope2*sharedNearPressure/point.nearDensity			
		})
	}
	return [forceX, forceY]
}

function calculateViscosityForce(samplePoint){
	var forceX = 0
	var forceY = 0
	for(var i = 0; i < 9; i++){
		var currentCellId = samplePoint.cellId+shifts[i]
		if(currentCellId < 0 || currentCellId >= cells.length) continue
		var cell = cells[currentCellId]

		cell.forEach(point => {
			var dst = Math.sqrt((samplePoint.predictedX-point.predictedX)**2 + (samplePoint.predictedY-point.predictedY)**2)
			if(dst == 0 || dst > smoothingRadius) return 0
			forceX += (point.vx-samplePoint.vx)*viscosity(smoothingRadius, dst)
			forceY += (point.vy-samplePoint.vy)*viscosity(smoothingRadius, dst)		
		})
	}
	return [forceX*viscosityScale, forceY*viscosityScale]
}

function calculateDensity(samplePoint){
	var d = 0
	for(var i = 0; i < 9; i++){
		var currentCellId = samplePoint.cellId+shifts[i]
		if(currentCellId < 0 || currentCellId >= cells.length) continue
		var cell = cells[currentCellId]

		cell.forEach(point => {
			var dst = Math.sqrt((samplePoint.predictedX-point.predictedX)**2 + (samplePoint.predictedY-point.predictedY)**2)
			if(dst > smoothingRadius) return 0
			d += smoothing(smoothingRadius, dst)		
		})
	}
	return d
}
function calculateNearDensity(samplePoint){
	var d = 0
	for(var i = 0; i < 9; i++){
		var currentCellId = samplePoint.cellId+shifts[i]
		if(currentCellId < 0 || currentCellId >= cells.length) continue
		var cell = cells[currentCellId]

		cell.forEach(point => {
			var dst = Math.sqrt((samplePoint.predictedX-point.predictedX)**2 + (samplePoint.predictedY-point.predictedY)**2)
			if(dst > smoothingRadius) return 0
			d += nearSmoothing(smoothingRadius, dst)
		})
	}
	return d
}

function stepPoints(){
	cells.forEach(cell => {
		cell.forEach(point => {
			point.density = calculateDensity(point)
			point.nearDensity = calculateNearDensity(point)
		})
	})

	cells.forEach(cell => {
		cell.forEach(point => {
			var pressureForce = calculatePressureForce(point)
			var viscosityForce = calculateViscosityForce(point)
			point.vx += viscosityForce[0] + pressureForce[0] / point.density
			point.vy += viscosityForce[1] + gravity + pressureForce[1] / point.density
		})
	})

	cells.forEach(cell => {
		cell.forEach(point => {
			if(mouse.down && (point.screenX - mouse.x)**2 + (point.screenY - mouse.y)**2 < mouseInteractionR**2){
				var force = 0
				if(mouse.key == 0) force = -mouseInteractionStr
				if(mouse.key == 2) force = mouseInteractionStr
				point.vx += force*(point.screenX-mouse.x)
				point.vy += force*(point.screenY-mouse.y)
			}
		})	
	})

	cells.forEach(cell => {
		for(var i = 0; i < cell.length; i++){
			var point = cell[i]

			var n = 100

			for(var f = 0; f < n; f++){
				point.x += point.vx / n
				point.screenX += point.vx / n
				
				obstacles.forEach(ob => {
					if(point.screenX >= ob[0] && point.screenY >= ob[1] && point.screenX <= ob[0]+ob[2] && point.screenY <= ob[1]+ob[3]){
						point.x -= point.vx / n
						point.screenX -= point.vx / n
						point.vx *= -0.3
					}
				})
	
				point.y += point.vy / n
				point.screenY += point.vy / n
	
				obstacles.forEach(ob => {
					if(point.screenX >= ob[0] && point.screenY >= ob[1] && point.screenX <= ob[0]+ob[2] && point.screenY <= ob[1]+ob[3]){
						point.y -= point.vy / n
						point.screenY -= point.vy / n
						point.vy *= -0.3
					}
				})
			}

			point.predictedX = point.screenX+point.vx
			point.predictedY = point.screenY+point.vy
		}

		for(var i = 0; i < cell.length; i++){
			var point = cell[i]
			
			if(point.screenX < 0){
				point.x = 0
				point.screenX = 0
				point.vx *= -0.3
			}
			if(point.screenY < 0){
				point.y = 0
				point.screenY = 0
				point.vy *= -0.3
			}
			if(point.screenX > c.width){
				point.x += c.width-point.screenX
				point.screenX = c.width
				point.vx *= -0.3
			}
			if(point.screenY > c.height){
				point.y += c.height-point.screenY
				point.screenY = c.height
				point.vy *= -0.1
			}

			if(point.x >= cellSize || point.x < 0 || point.y >= cellSize || point.y < 0){
				while(point.x < 0) point.x += cellSize
				while(point.y < 0) point.y += cellSize
				while(point.x > cellSize) point.x -= cellSize
				while(point.y > cellSize) point.y -= cellSize
				point.cellId = Math.floor(point.screenX/cellSize)+Math.floor(point.screenY/cellSize)*width
				cells[point.cellId].push(point)
				for(var k = 0; k < cell.length; k++){
					if(cell[k].id == point.id){
						cell.splice(k, 1)
						i=0
						break
					}
				}
			}
		}
	})
}

function draw(){
	ctx.clearRect(0,0,c.width,c.height)
	if(mouse.down){
		ctx.fillStyle = "#FFFFFF"
		ctx.beginPath()
		ctx.arc(mouse.x, mouse.y, mouseInteractionR, 0, 360)
		ctx.fill()
		ctx.fillStyle = "#000000"
		ctx.beginPath()
		ctx.arc(mouse.x, mouse.y, mouseInteractionR-1, 0, 360)
		ctx.fill()		
	}

	ctx.fillStyle = "blue"
	cells.forEach(cell => {
		cell.forEach(point => {
			ctx.beginPath()
			ctx.arc(point.screenX, point.screenY, pointSize, 0, 360)
			ctx.fill()
		})	
	})
	ctx.fillStyle = "gray"
	obstacles.forEach(ob => {
		ctx.fillRect(ob[0], ob[1], ob[2], ob[3])
	})

	if(obPlaceData){
		ctx.fillRect(obPlaceData[0], obPlaceData[1], mouse.x - obPlaceData[0], mouse.y - obPlaceData[1])
	}

	document.getElementById("noOptions").style.display = "None"
	document.getElementById("options").style.display = "None"
	if(options) document.getElementById("options").style.display = ""
	else document.getElementById("noOptions").style.display = ""
}

c.addEventListener("mousemove", function(e){
	mouse.x = e.x
	mouse.y = e.y
	if(pause) draw()
})

c.addEventListener("mousewheel", function(e){
	
})

c.addEventListener("mousedown", function(e){
	mouse.down = true
	mouse.key = e.button
})

c.addEventListener("mouseup", function(e){
	mouse.down = false
})

document.addEventListener("keydown", function(e){
	if(e.key == "o") options = 1-options
	if(e.key == "r") spawn()
	if(e.key == " ") pause = 1-pause
	if(e.key == "s") tick()
	if(e.key == "x"){
		for(var i = 0; i < obstacles.length; i++){
			var ob = obstacles[i]
			if(mouse.x >= ob[0] && mouse.y >= ob[1] && mouse.x <= ob[0]+ob[2] && mouse.y <= ob[1]+ob[3]){
				obstacles.splice(i, 1)
				i--
			}
		}
		draw()
	}
	if(e.key == "n"){
		if(obPlaceData){
			obstacles.push([obPlaceData[0], obPlaceData[1], mouse.x-obPlaceData[0], mouse.y-obPlaceData[1]])
			obPlaceData = undefined
			if(obstacles[obstacles.length-1][2] < 0){
				obstacles[obstacles.length-1][0] += obstacles[obstacles.length-1][2]
				obstacles[obstacles.length-1][2] *= -1
			}
			if(obstacles[obstacles.length-1][3] < 0){
				obstacles[obstacles.length-1][1] += obstacles[obstacles.length-1][3]
				obstacles[obstacles.length-1][3] *= -1
			}
		}
		else{
			obPlaceData = [mouse.x, mouse.y]
		}
		draw()
	}
})

function tick(){
	pointSize = 					Number(boxes[0].value)
	smoothingRadius = 				Number(boxes[1].value)
	targetDensity = 				Number(boxes[2].value)
	pressureMult = 					Number(boxes[3].value)
	gravity = 						Number(boxes[4].value)
	viscosityScale = 				Number(boxes[5].value)
	nearPressureMult = 				Number(boxes[6].value)
	smoothingFactor = 				Number(boxes[7].value)
	nearSmoothingDerivativeMult = 	Number(boxes[8].value)
	stepPoints()
	draw()
}

function spawn(){
	cells = []
	for(var i = 0; i < width*height; i++)
	cells.push([])
	for(var i = 0; i < particleCount; i++){
		var cid = Math.floor(Math.random()*width)+width*Math.floor(Math.random()*height)
		cells[cid].push(new Point(Math.random()*cellSize, Math.random()*cellSize, i, cid))
	}
	draw()
}
spawn()

window.addEventListener("contextmenu", e => e.preventDefault());

setInterval(function(){
	if(!pause) tick()
}, 20)