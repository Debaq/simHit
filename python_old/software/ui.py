# -*- coding: utf-8 -*-

################################################################################
## Form generated from reading UI file 'Ui_SimHit dbOSPW.ui'
##
## Created by: Qt User Interface Compiler version 6.7.1
##
## WARNING! All changes made in this file will be lost when recompiling UI file!
################################################################################

from PySide6.QtCore import (QCoreApplication, QDate, QDateTime, QLocale,
    QMetaObject, QObject, QPoint, QRect,
    QSize, QTime, QUrl, Qt)
from PySide6.QtGui import (QAction, QBrush, QColor, QConicalGradient,
    QCursor, QFont, QFontDatabase, QGradient,
    QIcon, QImage, QKeySequence, QLinearGradient,
    QPainter, QPalette, QPixmap, QRadialGradient,
    QTransform)
from PySide6.QtWidgets import (QApplication, QFrame, QHBoxLayout, QLabel,
    QMainWindow, QMenu, QMenuBar, QPushButton,
    QSizePolicy, QSlider, QSpacerItem, QStatusBar,
    QVBoxLayout, QWidget)

class Ui_SimHit(object):
    def setupUi(self, SimHit):
        if not SimHit.objectName():
            SimHit.setObjectName(u"SimHit")
        SimHit.resize(999, 748)
        self.actionSalir = QAction(SimHit)
        self.actionSalir.setObjectName(u"actionSalir")
        self.centralwidget = QWidget(SimHit)
        self.centralwidget.setObjectName(u"centralwidget")
        self.verticalLayout = QVBoxLayout(self.centralwidget)
        self.verticalLayout.setObjectName(u"verticalLayout")
        self.frame_btn_tools = QFrame(self.centralwidget)
        self.frame_btn_tools.setObjectName(u"frame_btn_tools")
        self.horizontalLayout_3 = QHBoxLayout(self.frame_btn_tools)
        self.horizontalLayout_3.setObjectName(u"horizontalLayout_3")
        self.btn_laser = QPushButton(self.frame_btn_tools)
        self.btn_laser.setObjectName(u"btn_laser")

        self.horizontalLayout_3.addWidget(self.btn_laser)

        self.btn_led_red = QPushButton(self.frame_btn_tools)
        self.btn_led_red.setObjectName(u"btn_led_red")

        self.horizontalLayout_3.addWidget(self.btn_led_red)

        self.btn_led_green = QPushButton(self.frame_btn_tools)
        self.btn_led_green.setObjectName(u"btn_led_green")

        self.horizontalLayout_3.addWidget(self.btn_led_green)

        self.btn_led_blue = QPushButton(self.frame_btn_tools)
        self.btn_led_blue.setObjectName(u"btn_led_blue")

        self.horizontalLayout_3.addWidget(self.btn_led_blue)

        self.horizontalSpacer = QSpacerItem(40, 20, QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)

        self.horizontalLayout_3.addItem(self.horizontalSpacer)


        self.verticalLayout.addWidget(self.frame_btn_tools)

        self.horizontalLayout = QHBoxLayout()
        self.horizontalLayout.setObjectName(u"horizontalLayout")
        self.layout_grahph_time = QVBoxLayout()
        self.layout_grahph_time.setObjectName(u"layout_grahph_time")

        self.horizontalLayout.addLayout(self.layout_grahph_time)

        self.layout_eye = QHBoxLayout()
        self.layout_eye.setObjectName(u"layout_eye")

        self.horizontalLayout.addLayout(self.layout_eye)


        self.verticalLayout.addLayout(self.horizontalLayout)

        self.frame_results = QFrame(self.centralwidget)
        self.frame_results.setObjectName(u"frame_results")
        self.horizontalLayout_2 = QHBoxLayout(self.frame_results)
        self.horizontalLayout_2.setObjectName(u"horizontalLayout_2")
        self.layout_rl = QVBoxLayout()
        self.layout_rl.setObjectName(u"layout_rl")

        self.horizontalLayout_2.addLayout(self.layout_rl)

        self.layout_results = QVBoxLayout()
        self.layout_results.setObjectName(u"layout_results")
        self.layout_gain = QHBoxLayout()
        self.layout_gain.setObjectName(u"layout_gain")
        self.lbl_gain_ll = QLabel(self.frame_results)
        self.lbl_gain_ll.setObjectName(u"lbl_gain_ll")
        font = QFont()
        font.setPointSize(14)
        font.setBold(True)
        self.lbl_gain_ll.setFont(font)
        self.lbl_gain_ll.setStyleSheet(u"color: rgb(255, 0, 0);")
        self.lbl_gain_ll.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.layout_gain.addWidget(self.lbl_gain_ll)

        self.line = QFrame(self.frame_results)
        self.line.setObjectName(u"line")
        self.line.setFrameShape(QFrame.Shape.VLine)
        self.line.setFrameShadow(QFrame.Shadow.Sunken)

        self.layout_gain.addWidget(self.line)

        self.lbl_gain_rl = QLabel(self.frame_results)
        self.lbl_gain_rl.setObjectName(u"lbl_gain_rl")
        self.lbl_gain_rl.setFont(font)
        self.lbl_gain_rl.setStyleSheet(u"color: rgb(0, 0, 255);")
        self.lbl_gain_rl.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.layout_gain.addWidget(self.lbl_gain_rl)


        self.layout_results.addLayout(self.layout_gain)

        self.layout_count = QHBoxLayout()
        self.layout_count.setObjectName(u"layout_count")
        self.horizontalSlider = QSlider(self.frame_results)
        self.horizontalSlider.setObjectName(u"horizontalSlider")
        self.horizontalSlider.setOrientation(Qt.Orientation.Horizontal)
        self.horizontalSlider.setInvertedAppearance(False)
        self.horizontalSlider.setInvertedControls(False)
        self.horizontalSlider.setTickPosition(QSlider.TickPosition.TicksAbove)

        self.layout_count.addWidget(self.horizontalSlider)

        self.lbl_last_impulse = QLabel(self.frame_results)
        self.lbl_last_impulse.setObjectName(u"lbl_last_impulse")
        self.lbl_last_impulse.setFont(font)
        self.lbl_last_impulse.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.layout_count.addWidget(self.lbl_last_impulse)

        self.btn_calibrate = QPushButton(self.frame_results)
        self.btn_calibrate.setObjectName(u"btn_calibrate")

        self.layout_count.addWidget(self.btn_calibrate)


        self.layout_results.addLayout(self.layout_count)

        self.layout_velocity = QVBoxLayout()
        self.layout_velocity.setObjectName(u"layout_velocity")

        self.layout_results.addLayout(self.layout_velocity)


        self.horizontalLayout_2.addLayout(self.layout_results)

        self.layout_ll = QVBoxLayout()
        self.layout_ll.setObjectName(u"layout_ll")

        self.horizontalLayout_2.addLayout(self.layout_ll)


        self.verticalLayout.addWidget(self.frame_results)

        SimHit.setCentralWidget(self.centralwidget)
        self.menubar = QMenuBar(SimHit)
        self.menubar.setObjectName(u"menubar")
        self.menubar.setGeometry(QRect(0, 0, 999, 30))
        self.menuGrabar = QMenu(self.menubar)
        self.menuGrabar.setObjectName(u"menuGrabar")
        SimHit.setMenuBar(self.menubar)
        self.statusbar = QStatusBar(SimHit)
        self.statusbar.setObjectName(u"statusbar")
        SimHit.setStatusBar(self.statusbar)

        self.menubar.addAction(self.menuGrabar.menuAction())
        self.menuGrabar.addAction(self.actionSalir)

        self.retranslateUi(SimHit)

        QMetaObject.connectSlotsByName(SimHit)
    # setupUi

    def retranslateUi(self, SimHit):
        SimHit.setWindowTitle(QCoreApplication.translate("SimHit", u"SimHit", None))
        self.actionSalir.setText(QCoreApplication.translate("SimHit", u"&Salir", None))
        self.btn_laser.setText(QCoreApplication.translate("SimHit", u"LASER : ON", None))
        self.btn_led_red.setText(QCoreApplication.translate("SimHit", u"RED : ON", None))
        self.btn_led_green.setText(QCoreApplication.translate("SimHit", u"GREEN : ON", None))
        self.btn_led_blue.setText(QCoreApplication.translate("SimHit", u"BLUE : ON", None))
        self.lbl_gain_ll.setText(QCoreApplication.translate("SimHit", u"&0,9", None))
        self.lbl_gain_rl.setText(QCoreApplication.translate("SimHit", u"0,&9", None))
        self.lbl_last_impulse.setText(QCoreApplication.translate("SimHit", u"&300\u00b0/s", None))
        self.btn_calibrate.setText(QCoreApplication.translate("SimHit", u"Calibrar", None))
        self.menuGrabar.setTitle(QCoreApplication.translate("SimHit", u"&Grabar", None))
    # retranslateUi

